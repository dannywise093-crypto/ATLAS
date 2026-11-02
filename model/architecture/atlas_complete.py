import json
import numpy as np
from pathlib import Path

from atlas_model import ATLASModel
from atlas_position import ATLASPositionalEncoding
from atlas_transformer import ATLSTransformerBlock


class ATLAS1:
    def __init__(self, vocab_size, embedding_dim=32):
        self.embedding = ATLASModel(
            vocab_size, embedding_dim
        )

        self.position = ATLASPositionalEncoding(
            embedding_dim
        )

        self.transformer = ATLSTransformerBlock(
            embedding_dim
        )

    def forward(self, token_ids):
        token_ids = np.asarray(token_ids, dtype=int)

        if token_ids.ndim != 1 or len(token_ids) == 0:
            raise ValueError("Expected a non-empty token sequence")

        x = self.embedding.embedding[token_ids]
        x = self.position.forward(x)
        x = self.transformer.forward(x)

        logits = (
            x @ self.embedding.output_weights
            + self.embedding.output_bias
        )

        return logits


if __name__ == "__main__":
    vocab_path = (
        Path(__file__).parents[1]
        / "tokenizer"
        / "vocabulary.json"
    )

    vocabulary = json.loads(
        vocab_path.read_text(encoding="utf-8")
    )

    model = ATLAS1(len(vocabulary))

    sample = [
        vocabulary["hello"],
        vocabulary["atlas"]
    ]

    output = model.forward(sample)

    print("ATLAS-1 complete architecture initialized.")
    print("Vocabulary size:", len(vocabulary))
    print("Input tokens:", len(sample))
    print("Output shape:", output.shape)
