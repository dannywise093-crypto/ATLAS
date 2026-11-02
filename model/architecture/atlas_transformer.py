import numpy as np

from atlas_attention import ATLASAttention


class ATLSTransformerBlock:
    def __init__(self, embedding_dim=32, hidden_dim=64, seed=42):
        rng = np.random.default_rng(seed)

        self.attention = ATLASAttention(embedding_dim, seed)

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
        attended = self.attention.forward(x)
        x = self.normalize(x + attended)

        feed_forward = np.maximum(0, x @ self.W1) @ self.W2
        x = self.normalize(x + feed_forward)

        return x


if __name__ == "__main__":
    block = ATLSTransformerBlock()

    sample = np.random.default_rng(1).normal(
        size=(4, 32)
    ).astype(np.float32)

    output = block.forward(sample)

    print("ATLAS Transformer block initialized.")
    print("Input shape:", sample.shape)
    print("Output shape:", output.shape)
