import json
import re
from pathlib import Path

SPECIAL_TOKENS = ["<PAD>", "<UNK>", "<BOS>", "<EOS>"]

BASE = Path(__file__).resolve().parents[1]
DATASET = BASE / "training" / "atlas_training.txt"
OUTPUT = BASE / "tokenizer" / "vocabulary.json"


def tokenize(text):
    return re.findall(
        r"\w+|[^\w\s]",
        text.lower(),
        flags=re.UNICODE
    )


def build_vocabulary(texts):
    words = set()

    for text in texts:
        words.update(tokenize(text))

    vocabulary = SPECIAL_TOKENS + sorted(words)

    return {
        token: index
        for index, token in enumerate(vocabulary)
    }


def encode(text, vocabulary):
    unknown_id = vocabulary["<UNK>"]

    return [
        vocabulary.get(token, unknown_id)
        for token in tokenize(text)
    ]


if __name__ == "__main__":
    if not DATASET.exists():
        raise FileNotFoundError("Training dataset not found.")

    texts = DATASET.read_text(
        encoding="utf-8"
    ).splitlines()

    vocabulary = build_vocabulary(texts)

    OUTPUT.write_text(
        json.dumps(vocabulary, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print("ATLAS tokenizer initialized.")
    print("Training sentences:", len(texts))
    print("Vocabulary size:", len(vocabulary))
    print("Vocabulary saved:", OUTPUT)
