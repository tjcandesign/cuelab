"""`python -m cuelab` — same as `python -m uvicorn cuelab.main:app --port 8000`."""

from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run("cuelab.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
