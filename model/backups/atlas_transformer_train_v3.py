import json
import numpy as np
from pathlib import Path


class ATLASTransformer:
    def __init__(
        self,
        vocab_size,
        embedding_dim=32,
        num_heads=4,
        hidden_dim=64,
        max_length=16,
        seed=42
    ):
        if embedding_dim % num_heads != 0:
            raise ValueError("Embedding dimension must divide by heads")

        self.vocab_size = vocab_size
        self.embedding_dim = embedding_dim
        self.num_heads = num_heads
        self.head_dim = embedding_dim // num_heads
        self.max_length = max_length

        rng = np.random.default_rng(seed)

        def weight(shape):
            return rng.normal(0, 0.02, shape).astype(np.float32)

        # Token embeddings
        self.embedding = weight((vocab_size, embedding_dim))

        # Multi-head attention projections
        self.Wq = weight((embedding_dim, embedding_dim))
        self.Wk = weight((embedding_dim, embedding_dim))
        self.Wv = weight((embedding_dim, embedding_dim))
        self.Wo = weight((embedding_dim, embedding_dim))

        # Feed-forward network
        self.W1 = weight((embedding_dim, hidden_dim))
        self.b1 = np.zeros(hidden_dim, dtype=np.float32)

        self.W2 = weight((hidden_dim, embedding_dim))
        self.b2 = np.zeros(embedding_dim, dtype=np.float32)

        # Output prediction layer
        self.Wout = weight((embedding_dim, vocab_size))
        self.bout = np.zeros(vocab_size, dtype=np.float32)

        self.position = self.create_positions(max_length)

    def create_positions(self, length):
        positions = np.arange(length)[:, None]
        dimensions = np.arange(self.embedding_dim)[None, :]

        angles = positions / np.power(
            10000,
            (2 * (dimensions // 2)) / self.embedding_dim
        )

        encoding = np.zeros(
            (length, self.embedding_dim),
            dtype=np.float32
        )

        encoding[:, 0::2] = np.sin(angles[:, 0::2])
        encoding[:, 1::2] = np.cos(angles[:, 1::2])

        return encoding

    def normalize(self, x):
        mean = x.mean(axis=-1, keepdims=True)
        variance = x.var(axis=-1, keepdims=True)

        return (x - mean) / np.sqrt(variance + 1e-5)

    def attention(self, x):
        length = x.shape[0]

        q = (x @ self.Wq).reshape(
            length, self.num_heads, self.head_dim
        ).transpose(1, 0, 2)

        k = (x @ self.Wk).reshape(
            length, self.num_heads, self.head_dim
        ).transpose(1, 0, 2)

        v = (x @ self.Wv).reshape(
            length, self.num_heads, self.head_dim
        ).transpose(1, 0, 2)

        scores = q @ k.transpose(0, 2, 1)
        scores /= np.sqrt(self.head_dim)

        # Causal mask: block access to future tokens.
        mask = np.triu(
            np.ones((length, length), dtype=bool),
            k=1
        )

        scores = np.where(mask[None, :, :], -1e9, scores)

        scores -= scores.max(axis=-1, keepdims=True)

        probabilities = np.exp(scores)
        probabilities /= probabilities.sum(
            axis=-1, keepdims=True
        )

        attended = probabilities @ v

        attended = attended.transpose(1, 0, 2).reshape(
            length, self.embedding_dim
        )

        return attended @ self.Wo

    def forward(self, token_ids):
        token_ids = np.asarray(token_ids, dtype=int)

        if token_ids.ndim != 1 or len(token_ids) == 0:
            raise ValueError("Expected a non-empty token sequence")

        if len(token_ids) > self.max_length:
            raise ValueError("Sequence exceeds maximum length")

        if np.any(token_ids < 0) or np.any(
            token_ids >= self.vocab_size
        ):
            raise ValueError("Invalid token ID")

        # Embedding and positional information
        embedding_output = self.embedding[token_ids].copy()
        x = embedding_output + self.position[:len(token_ids)]

        # Attention block
        attention_output = self.attention(x)
        attention_residual = x + attention_output
        attention_norm = self.normalize(attention_residual)

        # Feed-forward block
        feed_forward_pre = attention_norm @ self.W1 + self.b1
        feed_forward_hidden = np.maximum(0, feed_forward_pre)
        feed_forward_output = feed_forward_hidden @ self.W2 + self.b2

        final_residual = attention_norm + feed_forward_output
        final_hidden = self.normalize(final_residual)

        # Predict vocabulary tokens
        logits = final_hidden @ self.Wout + self.bout

        # Save intermediate values for backpropagation
        self.cache = {
            "token_ids": token_ids.copy(),
            "embedding_output": embedding_output,
            "attention_input": x,
            "attention_residual": attention_residual,
            "attention_norm": attention_norm,
            "feed_forward_pre": feed_forward_pre,
            "feed_forward_hidden": feed_forward_hidden,
            "feed_forward_output": feed_forward_output,
            "final_residual": final_residual,
            "final_hidden": final_hidden
        }

        return logits


if __name__ == "__main__":
    BASE = Path(__file__).resolve().parents[1]

    vocab_path = BASE / "tokenizer" / "vocabulary.json"

    vocab = json.loads(
        vocab_path.read_text(encoding="utf-8")
    )

    model = ATLASTransformer(
        vocab_size=len(vocab)
    )

    sample = [
        vocab["atlas"],
        vocab["learns"],
        vocab["language"]
    ]

    output = model.forward(sample)

    print("ATLAS Transformer Training Engine")
    print("Vocabulary:", len(vocab))
    print("Attention heads:", model.num_heads)
    print("Embedding dimension:", model.embedding_dim)
    print("Input shape:", (len(sample),))
    print("Output shape:", output.shape)
    print("Forward pass successful.")

    # Probability validation
    shifted = output - output.max(axis=-1, keepdims=True)
    exp_values = np.exp(shifted)
    probabilities = exp_values / exp_values.sum(axis=-1, keepdims=True)

    print("Probability shape:", probabilities.shape)
    print("Probability sum per token:", probabilities.sum(axis=-1))
    print("All probabilities valid:", np.all(np.isfinite(probabilities)))


def cross_entropy_loss(logits, targets):
    targets = np.asarray(targets, dtype=int)

    if logits.shape[0] != len(targets):
        raise ValueError("Logits and targets must have matching lengths")

    shifted = logits - logits.max(axis=-1, keepdims=True)
    log_sum_exp = np.log(
        np.exp(shifted).sum(axis=-1)
    )

    target_scores = shifted[
        np.arange(len(targets)), targets
    ]

    return float(np.mean(log_sum_exp - target_scores))


if __name__ == "__main__":
    targets = [
        vocab["learns"],
        vocab["language"],
        vocab["tokens"]
    ]

    loss = cross_entropy_loss(output, targets)
    print("Cross-entropy loss:", loss)
    print("Loss is finite:", np.isfinite(loss))


def output_layer_gradients(model, logits, hidden_states, targets):
    targets = np.asarray(targets, dtype=int)
    shifted = logits - logits.max(axis=-1, keepdims=True)

    probabilities = np.exp(shifted)
    probabilities /= probabilities.sum(axis=-1, keepdims=True)

    gradients = probabilities.copy()
    gradients[np.arange(len(targets)), targets] -= 1
    gradients /= len(targets)

    grad_Wout = hidden_states.T @ gradients
    grad_bout = gradients.sum(axis=0)

    return grad_Wout, grad_bout


if __name__ == "__main__":
    hidden_states = model.embedding[sample].copy()
    hidden_states += model.position[:len(sample)]

    attention_output = model.attention(hidden_states)
    hidden_states = model.normalize(hidden_states + attention_output)

    feed_forward = np.maximum(0, hidden_states @ model.W1 + model.b1)
    feed_forward = feed_forward @ model.W2 + model.b2
    hidden_states = model.normalize(hidden_states + feed_forward)

    grad_Wout, grad_bout = output_layer_gradients(
        model, output, hidden_states, targets
    )

    print("Output weight gradient shape:", grad_Wout.shape)
    print("Output bias gradient shape:", grad_bout.shape)
    print("Gradients finite:",
          np.all(np.isfinite(grad_Wout)) and
          np.all(np.isfinite(grad_bout)))


if __name__ == "__main__":
    old_loss = cross_entropy_loss(output, targets)

    learning_rate = 0.01

    old_Wout = model.Wout.copy()
    old_bout = model.bout.copy()

    model.Wout -= learning_rate * grad_Wout
    model.bout -= learning_rate * grad_bout

    updated_logits = hidden_states @ model.Wout + model.bout
    new_loss = cross_entropy_loss(updated_logits, targets)

    print("Loss before update:", old_loss)
    print("Loss after update:", new_loss)
    print("Output weights changed:",
          not np.array_equal(old_Wout, model.Wout))
    print("Training step successful:", new_loss < old_loss)
