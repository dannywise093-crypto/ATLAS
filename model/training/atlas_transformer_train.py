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

        mask = np.triu(
            np.ones((length, length), dtype=bool), k=1
        )

        scores = np.where(mask[None, :, :], -1e9, scores)
        scores -= scores.max(axis=-1, keepdims=True)

        probabilities = np.exp(scores)
        probabilities /= probabilities.sum(
            axis=-1, keepdims=True
        )

        attended = probabilities @ v

        combined = attended.transpose(1, 0, 2).reshape(
            length, self.embedding_dim
        )

        output = combined @ self.Wo

        self.attention_cache = {
            "input": x.copy(),
            "q": q.copy(),
            "k": k.copy(),
            "v": v.copy(),
            "probabilities": probabilities.copy(),
            "attended": attended.copy(),
            "combined": combined.copy(),
            "mask": mask.copy()
        }

        return output

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


def feed_forward_gradients(model, upstream_gradient):
    """
    Backpropagate through the feed-forward block.

    Returns gradients for W1, b1, W2, b2
    and the feed-forward input.
    """
    cache = model.cache

    x = cache["attention_norm"]
    hidden = cache["feed_forward_hidden"]
    pre_activation = cache["feed_forward_pre"]

    # Gradient through second linear layer
    grad_W2 = hidden.T @ upstream_gradient
    grad_b2 = upstream_gradient.sum(axis=0)

    grad_hidden = upstream_gradient @ model.W2.T

    # Gradient through ReLU
    grad_pre = grad_hidden * (pre_activation > 0)

    # Gradient through first linear layer
    grad_W1 = x.T @ grad_pre
    grad_b1 = grad_pre.sum(axis=0)

    grad_input = grad_pre @ model.W1.T

    return {
        "W1": grad_W1,
        "b1": grad_b1,
        "W2": grad_W2,
        "b2": grad_b2,
        "input": grad_input
    }

def layer_norm_backward(upstream_gradient, original_input, epsilon=1e-5):
    """
    Backpropagation through row-wise Layer Normalization.
    """
    feature_count = original_input.shape[-1]

    mean = original_input.mean(axis=-1, keepdims=True)
    variance = original_input.var(axis=-1, keepdims=True)

    normalized = (original_input - mean) / np.sqrt(variance + epsilon)

    gradient_sum = upstream_gradient.sum(axis=-1, keepdims=True)
    gradient_normalized_sum = (
        upstream_gradient * normalized
    ).sum(axis=-1, keepdims=True)

    return (
        feature_count * upstream_gradient
        - gradient_sum
        - normalized * gradient_normalized_sum
    ) / (feature_count * np.sqrt(variance + epsilon))


def final_residual_backward(upstream_gradient, model):
    """
    Backpropagate through the final LayerNorm and residual connection.

    Returns gradients for:
    - feed_forward_output
    - attention_norm
    """
    cache = model.cache

    # Backpropagate through final LayerNorm.
    gradient_residual = layer_norm_backward(
        upstream_gradient,
        cache["final_residual"]
    )

    # Both branches of the residual addition receive the gradient.
    gradient_feed_forward_output = gradient_residual.copy()
    gradient_attention_norm = gradient_residual.copy()

    return {
        "feed_forward_output": gradient_feed_forward_output,
        "attention_norm": gradient_attention_norm
    }


def feed_forward_block_backward(upstream_gradient, model):
    """
    Backpropagate through the final residual and feed-forward block.
    """
    residual_gradients = final_residual_backward(
        upstream_gradient, model
    )

    feed_forward_gradients_result = feed_forward_gradients(
        model,
        residual_gradients["feed_forward_output"]
    )

    gradient_attention_norm = (
        residual_gradients["attention_norm"]
        + feed_forward_gradients_result["input"]
    )

    return {
        "W1": feed_forward_gradients_result["W1"],
        "b1": feed_forward_gradients_result["b1"],
        "W2": feed_forward_gradients_result["W2"],
        "b2": feed_forward_gradients_result["b2"],
        "attention_norm": gradient_attention_norm
    }


def attention_backward(upstream_gradient, model):
    cache = model.attention_cache

    x = cache["input"]
    q = cache["q"]
    k = cache["k"]
    v = cache["v"]
    probabilities = cache["probabilities"]
    attended = cache["attended"]
    combined = cache["combined"]
    mask = cache["mask"]

    length = x.shape[0]
    scale = np.sqrt(model.head_dim)

    # Output projection gradients
    grad_Wo = combined.T @ upstream_gradient
    grad_combined = upstream_gradient @ model.Wo.T

    # Restore the multi-head dimensions
    grad_attended = grad_combined.reshape(
        length, model.num_heads, model.head_dim
    ).transpose(1, 0, 2)

    # Attention value and probability gradients
    grad_probabilities = grad_attended @ v.transpose(0, 2, 1)
    grad_v = probabilities.transpose(0, 2, 1) @ grad_attended

    # Softmax backward
    grad_scores = probabilities * (
        grad_probabilities
        - (grad_probabilities * probabilities).sum(
            axis=-1, keepdims=True
        )
    )

    grad_scores = np.where(mask[None, :, :], 0.0, grad_scores)

    # Query and key gradients
    grad_q = grad_scores @ k / scale
    grad_k = grad_scores.transpose(0, 2, 1) @ q / scale

    # Merge head gradients
    def merge_heads(values):
        return values.transpose(1, 0, 2).reshape(
            length, model.embedding_dim
        )

    grad_q = merge_heads(grad_q)
    grad_k = merge_heads(grad_k)
    grad_v = merge_heads(grad_v)

    # Projection weight gradients
    grad_Wq = x.T @ grad_q
    grad_Wk = x.T @ grad_k
    grad_Wv = x.T @ grad_v

    # Gradient flowing back into the attention input
    grad_input = (
        grad_q @ model.Wq.T
        + grad_k @ model.Wk.T
        + grad_v @ model.Wv.T
    )

    return {
        "Wq": grad_Wq,
        "Wk": grad_Wk,
        "Wv": grad_Wv,
        "Wo": grad_Wo,
        "input": grad_input
    }


def transformer_backward(model, logits, targets):
    """
    Backpropagate through the complete ATLAS Transformer.
    Returns gradients without updating model weights.
    """
    cache = model.cache

    targets = np.asarray(targets, dtype=int)

    if targets.shape != (logits.shape[0],):
        raise ValueError("Targets must contain one token ID per position")

    if np.any(targets < 0) or np.any(targets >= model.vocab_size):
        raise ValueError("Invalid target token ID")

    # Output projection and cross-entropy
    output_gradients = output_layer_backward(
        model, logits, cache["final_hidden"], targets
    )

    gradient_final_hidden = output_gradients["hidden"]

    # Final LayerNorm and feed-forward block
    block_gradients = feed_forward_block_backward(
        gradient_final_hidden, model
    )

    # Attention LayerNorm
    gradient_attention_residual = layer_norm_backward(
        block_gradients["attention_norm"],
        cache["attention_residual"]
    )

    # Attention residual connection
    gradient_attention_output = gradient_attention_residual
    gradient_attention_input = gradient_attention_residual.copy()

    # Multi-head attention
    attention_gradients = attention_backward(
        gradient_attention_output, model
    )

    gradient_attention_input += attention_gradients["input"]

    # Token embeddings: accumulate repeated token IDs
    gradient_embedding = np.zeros_like(model.embedding)

    np.add.at(
        gradient_embedding,
        cache["token_ids"],
        gradient_attention_input
    )

    return {
        "Wout": output_gradients["Wout"],
        "bout": output_gradients["bout"],
        "W1": block_gradients["W1"],
        "b1": block_gradients["b1"],
        "W2": block_gradients["W2"],
        "b2": block_gradients["b2"],
        "Wq": attention_gradients["Wq"],
        "Wk": attention_gradients["Wk"],
        "Wv": attention_gradients["Wv"],
        "Wo": attention_gradients["Wo"],
        "embedding": gradient_embedding
    }


def output_layer_backward(model, logits, hidden_states, targets):
    targets = np.asarray(targets, dtype=int)

    shifted = logits - logits.max(axis=-1, keepdims=True)
    probabilities = np.exp(shifted)
    probabilities /= probabilities.sum(axis=-1, keepdims=True)

    gradient_logits = probabilities.copy()
    gradient_logits[np.arange(len(targets)), targets] -= 1
    gradient_logits /= len(targets)

    return {
        "Wout": hidden_states.T @ gradient_logits,
        "bout": gradient_logits.sum(axis=0),
        "hidden": gradient_logits @ model.Wout.T
    }
