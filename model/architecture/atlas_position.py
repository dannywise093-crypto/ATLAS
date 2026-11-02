import numpy as np


class ATLASPositionalEncoding:
    def __init__(self, embedding_dim=32):
        self.embedding_dim = embedding_dim

    def forward(self, x):
        x = np.asarray(x, dtype=np.float32)

        if x.ndim != 2 or x.shape[1] != self.embedding_dim:
            raise ValueError("Expected [sequence_length, embedding_dim]")

        sequence_length = x.shape[0]

        positions = np.arange(sequence_length)[:, np.newaxis]
        dimensions = np.arange(self.embedding_dim)[np.newaxis, :]

        angles = positions / np.power(
            10000,
            (2 * (dimensions // 2)) / self.embedding_dim
        )

        encoding = np.zeros_like(angles, dtype=np.float32)

        encoding[:, 0::2] = np.sin(angles[:, 0::2])
        encoding[:, 1::2] = np.cos(angles[:, 1::2])

        return x + encoding


if __name__ == "__main__":
    positional = ATLASPositionalEncoding(32)

    sample = np.zeros((4, 32), dtype=np.float32)
    output = positional.forward(sample)

    print("ATLAS positional encoding initialized.")
    print("Input shape:", sample.shape)
    print("Output shape:", output.shape)
    print("First position:", output[0, :4])
    print("Second position:", output[1, :4])
