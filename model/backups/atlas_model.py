import numpy as np

class ATLASModel:
    def __init__(self, vocab_size, embedding_dim=32):
        self.vocab_size = vocab_size
        self.embedding_dim = embedding_dim

        rng = np.random.default_rng(42)

        self.embedding = rng.normal(
            0, 0.02, (vocab_size, embedding_dim)
        )

        self.output_weights = rng.normal(
            0, 0.02, (embedding_dim, vocab_size)
        )

        self.output_bias = np.zeros(vocab_size)

    def forward(self, token_ids):
        token_ids = np.asarray(token_ids, dtype=int)

        if np.any(token_ids < 0) or np.any(token_ids >= self.vocab_size):
            raise ValueError("Invalid token ID")

        hidden = self.embedding[token_ids]
        logits = hidden @ self.output_weights + self.output_bias

        return logits

if __name__ == "__main__":
    import json
    from pathlib import Path

    vocab_path = Path(__file__).parents[1] / "tokenizer" / "vocabulary.json"

    vocabulary = json.loads(vocab_path.read_text())

    model = ATLASModel(vocab_size=len(vocabulary))

    sample = [vocabulary["hello"], vocabulary["atlas"]]
    output = model.forward(sample)

    print("ATLAS-1 neural prototype initialized.")
    print("Vocabulary size:", model.vocab_size)
    print("Embedding dimension:", model.embedding_dim)
    print("Output shape:", output.shape)
