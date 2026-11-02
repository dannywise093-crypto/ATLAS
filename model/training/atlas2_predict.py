import json
import numpy as np
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

vocab = json.loads(
    (BASE / "tokenizer" / "vocabulary.json").read_text()
)

reverse_vocab = {v: k for k, v in vocab.items()}

model = np.load(
    BASE / "checkpoints" / "atlas2_context_model.npz"
)

E = model["embeddings"]
W1 = model["W1"]
W2 = model["W2"]
b = model["bias"]


def predict_next(sentence):
    words = sentence.lower().split()

    if not words:
        print("Please enter some words.")
        return

    if any(word not in vocab for word in words):
        print("One or more words are outside the vocabulary.")
        return

    context = [vocab[word] for word in words]
    x = E[context].mean(axis=0)

    hidden = np.tanh(x @ W1)
    logits = hidden @ W2 + b

    probabilities = np.exp(logits - np.max(logits))
    probabilities /= probabilities.sum()

    best = np.argsort(probabilities)[::-1][:3]

    print(f"\nInput: {sentence}")
    print("Next-word predictions:")

    for token_id in best:
        print(
            reverse_vocab[token_id],
            f"({probabilities[token_id]:.4f})"
        )


print("ATLAS-2 context prediction test")

predict_next("artificial")
predict_next("artificial intelligence")
predict_next("atlas is")
predict_next("hello")
