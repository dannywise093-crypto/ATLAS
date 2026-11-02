import numpy as np


class ATLASAttention:
    def __init__(self, embedding_dim=32, seed=42):
        rng = np.random.default_rng(seed)
        self.embedding_dim = embedding_dim

        self.Wq = rng.normal(0, 0.02, (embedding_dim, embedding_dim))
        self.Wk = rng.normal(0, 0.02, (embedding_dim, embedding_dim))
        self.Wv = rng.normal(0, 0.02, (embedding_dim, embedding_dim))

    def forward(self, x):
        x = np.asarray(x, dtype=np.float32)

        if x.ndim != 2 or x.shape[1] != self.embedding_dim:
            raise ValueError("Expected [sequence_length, embedding_dim]")

        q = x @ self.Wq
        k = x @ self.Wk
        v = x @ self.Wv

        scores = q @ k.T / np.sqrt(self.embedding_dim)

        # Prevent each token from attending to future tokens.
        future_mask = np.triu(
            np.ones(scores.shape, dtype=bool), k=1
        )
        scores = np.where(future_mask, -1e9, scores)

        scores -= np.max(scores, axis=-1, keepdims=True)

        weights = np.exp(scores)
        weights /= np.sum(weights, axis=-1, keepdims=True)

        return weights @ v


if __name__ == "__main__":
    attention = ATLASAttention(embedding_dim=32)

    sample = np.random.default_rng(1).normal(
        size=(4, 32)
    ).astype(np.float32)

    output = attention.forward(sample)

    print("ATLAS causal attention initialized.")
    print("Input shape:", sample.shape)
    print("Output shape:", output.shape)
