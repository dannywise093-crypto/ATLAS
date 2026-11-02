import json
import numpy as np
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

vocab = json.loads(
    (BASE / "tokenizer" / "vocabulary.json").read_text()
)

checkpoint = np.load(
    BASE / "checkpoints" / "atlas_toy_model.npz"
)

E = checkpoint["embeddings"]
W = checkpoint["weights"]
b = checkpoint["bias"]

reverse_vocab = {index: word for word, index in vocab.items()}

def predict_next(word):
    word = word.lower()

    if word not in vocab:
        print("Word not in vocabulary.")
        return

    hidden = np.tanh(E[vocab[word]])
    logits = hidden @ W + b

    probabilities = np.exp(logits - np.max(logits))
    probabilities /= probabilities.sum()

    best = np.argsort(probabilities)[::-1][:3]

    print(f"\nPredictions after '{word}':")

    for token_id in best:
        print(
            reverse_vocab[token_id],
            f"({probabilities[token_id]:.4f})"
        )


print("ATLAS learned-word prediction test")
predict_next("atlas")
predict_next("artificial")
predict_next("hello")
