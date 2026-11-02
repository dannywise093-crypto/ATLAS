import numpy as np

from atlas_multihead import ATLASMultiHeadAttention


class ATLSTransformerV2:
    def __init__(
        self,
        embedding_dim=32,
        hidden_dim=64,
        num_heads=4,
        seed=42
    ):
        rng = np.random.default_rng(seed)

        self.embedding_dim = embedding_dim

        self.attention = ATLASMultiHeadAttention(
            embedding_dim,
            num_heads,
            seed
        )

        self.W1 = rng.normal(
            0, 0.02, (embedding_dim, hidden_dim)
        )

        self.W2 = rng.normal(
            0, 0.02, (hidden_dim, embedding_dim)
        )

    def normalize(self, x):
        mean = x.mean(axis=-1, keepdims=True)
        variance = x.var(axis=-1, keepdims=True)

        return (x - mean) / np.sqrt(variance + 1e-5)

    def forward(self, x):
        x = np.asarray(x, dtype=np.float32)

        if x.ndim != 2 or x.shape[1] != self.embedding_dim:
            raise ValueError("Invalid input shape")

        attended = self.attention.forward(x)
        x = self.normalize(x + attended)

        feed_forward = np.maximum(0, x @ self.W1) @ self.W2
        x = self.normalize(x + feed_forward)

        return x


if __name__ == "__main__":
    model = ATLSTransformerV2()

    sample = np.random.default_rng(1).normal(
        size=(4, 32)
    ).astype(np.float32)

    output = model.forward(sample)

    print("ATLAS Transformer V2 initialized.")
    print("Attention heads:", model.attention.num_heads)
    print("Input shape:", sample.shape)
    print("Output shape:", output.shape)
