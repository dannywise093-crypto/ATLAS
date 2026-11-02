import sys
import re
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atlas_model_loader import load_atlas

model, vocab = load_atlas()
reverse_vocab = {i: t for t, i in vocab.items()}

def tokenize(text):
    return re.findall(r"\w+|[^\w\s]", text.lower())

def generate(prompt, max_new_tokens=15, temperature=0.8,
             top_k=8, repetition_penalty=1.2):

    words = tokenize(prompt)
    token_ids = [vocab.get(word, vocab["<UNK>"]) for word in words]

    generated = []

    for _ in range(max_new_tokens):
        context = token_ids[-model.position.shape[0]:]
        logits = model.forward(context)[-1].astype(np.float64).copy()

        for special in ["<PAD>", "<UNK>", "<BOS>"]:
            if special in vocab:
                logits[vocab[special]] = -np.inf

        for token_id in set(token_ids):
            if token_id < len(logits):
                if logits[token_id] > 0:
                    logits[token_id] /= repetition_penalty
                else:
                    logits[token_id] *= repetition_penalty

        logits /= temperature

        candidates = np.argsort(logits)[-top_k:]
        candidate_logits = logits[candidates]

        candidate_logits -= np.max(candidate_logits)
        probabilities = np.exp(candidate_logits)
        probabilities /= probabilities.sum()

        next_id = int(np.random.choice(candidates, p=probabilities))
        next_token = reverse_vocab[next_id]

        if next_token == "<EOS>":
            break

        token_ids.append(next_id)
        generated.append(next_token)

    return prompt + " " + " ".join(generated)


if __name__ == "__main__":
    print("ATLAS IMPROVED TEXT GENERATOR")
    print("-" * 40)

    for prompt in [
        "artificial intelligence",
        "neural networks",
        "ATLAS"
    ]:
        print("\nPrompt:", prompt)
        print("Generated:", generate(prompt))
