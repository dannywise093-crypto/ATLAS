import numpy as np


class ATLASMultiHeadAttention:
    def __init__(self, embedding_dim=32, num_heads=4, seed=42):
        if embedding_dim % num_heads != 0:
            raise ValueError("Embedding dimension must divide evenly by heads")

        rng = np.random.default_rng(seed)

        self.embedding_dim = embedding_dim
        self.num_heads = num_heads
        self.head_dim = embedding_dim // num_heads

        self.Wq = rng.normal(
            0, 0.02, (embedding_dim, embedding_dim)
        )
        self.Wk = rng.normal(
            0, 0.02, (embedding_dim, embedding_dim)
        )
        self.Wv = rng.normal(
            0, 0.02, (embedding_dim, embedding_dim)
        )
        self.Wo = rng.normal(
            0, 0.02, (embedding_dim, embedding_dim)
        )

    def forward(self, x):
        x = np.asarray(x, dtype=np.float32)

        if x.ndim != 2 or x.shape[1] != self.embedding_dim:
            raise ValueError("Invalid input shape")

        sequence_length = x.shape[0]

        q = (x @ self.Wq).reshape(
            sequence_length, self.num_heads, self.head_dim
        ).transpose(1, 0, 2)

        k = (x @ self.Wk).reshape(
            sequence_length, self.num_heads, self.head_dim
        ).transpose(1, 0, 2)

        v = (x @ self.Wv).reshape(
            sequence_length, self.num_heads, self.head_dim
        ).transpose(1, 0, 2)

        scores = q @ k.transpose(0, 2, 1)
        scores /= np.sqrt(self.head_dim)

        mask = np.triu(
            np.ones((sequence_length, sequence_length), dtype=bool),
            k=1
        )

        scores = np.where(mask[None, :, :], -1e9, scores)

        scores -= np.max(scores, axis=-1, keepdims=True)

        weights = np.exp(scores)
        weights /= weights.sum(axis=-1, keepdims=True)

        attended = weights @ v

        attended = attended.transpose(1, 0, 2).reshape(
            sequence_length, self.embedding_dim
        )

        return attended @ self.Wo


if __name__ == "__main__":
    attention = ATLASMultiHeadAttention()

    sample = np.random.default_rng(1).normal(
        size=(4, 32)
    ).astype(np.float32)

    output = attention.forward(sample)

    print("ATLAS multi-head causal attention initialized.")
    print("Attention heads:", attention.num_heads)
    print("Input shape:", sample.shape)
    print("Output shape:", output.shape)
