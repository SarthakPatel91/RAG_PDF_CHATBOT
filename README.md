# Ask Your PDF: a RAG chatbot for PDF documents

Upload a PDF, type a question, and get an answer based only on the text of that file.

The project is a Node.js and Express server with a simple web page that runs on your own computer (`localhost`). It uses **Retrieval-Augmented Generation (RAG)**: the PDF is split into pieces, each piece is turned into a vector with Google Gemini, the vectors are stored in **Qdrant**, and the piece that best matches your question is sent to Gemini to write the answer.

---

## Table of contents

1. [What is RAG?](#what-is-rag)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Project flowchart](#project-flowchart)
5. [System architecture](#system-architecture)
6. [Request flow](#request-flow)
7. [How data is stored in Qdrant](#how-data-is-stored-in-qdrant)
8. [Project structure](#project-structure)
9. [Getting started](#getting-started)
10. [API reference](#api-reference)
11. [Configuration](#configuration)
12. [Troubleshooting](#troubleshooting)
13. [Limitations and future improvements](#limitations-and-future-improvements)

---

## What is RAG?

A language model does not know what is inside your PDF, and long PDFs are expensive to send in full. RAG (Retrieval-Augmented Generation) solves this in three steps: **retrieve** the part of the PDF closest to the question, **augment** the prompt with that part, and **generate** an answer from it.

To find the closest part, text is converted into **embeddings**: lists of numbers where texts with similar meaning have similar numbers. A **vector database** (Qdrant here) compares them quickly.

### Indexing

```text
  INDEXING: runs when you upload a PDF
                        |
                        v
  +-------------------------------------------+
  | PDF file uploaded by the user             |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Extract the text (pdf-parse)              |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Split the text into chunks                |
  | (on blank lines)                          |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Create an embedding for every             |
  | chunk (gemini-embedding-001)              |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Store in Qdrant (collection pdf-docs)     |
  | chunk text + vector of 3072 numbers       |
  +-------------------------------------------+
  DONE: the PDF is searchable
```

### Querying

```text
  QUERYING: runs when you ask a question
                        |
                        v
  +-------------------------------------------+
  | User question typed on the page           |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Create an embedding of the question       |
  | (same model: gemini-embedding-001)        |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Search Qdrant by cosine similarity        |
  | and take the closest chunk (top 1)        |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Build the prompt:                         |
  | closest chunk + question                  |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Gemini writes the answer                  |
  | (gemini-3.5-flash-lite)                   |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | Answer shown in the browser               |
  +-------------------------------------------+
  DONE
```

The model only sees the best matching chunk, not the whole PDF, so the answer stays grounded in the document.

---

## Features

- Upload any text-based PDF from the browser
- Ask a question in plain language and get a short answer
- Semantic search: finds text by meaning, not just exact words
- Vector storage in Qdrant Cloud (free tier is enough)
- Temporary upload files are deleted right after they are read
- Clear error messages for missing files, missing questions and empty PDFs
- One command to run: the Express server also serves the web page

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS and JavaScript (`public/index.html`) |
| Backend | Node.js, Express 5 |
| File upload | Multer |
| PDF text extraction | pdf-parse |
| Embeddings | Google Gemini `gemini-embedding-001` (via `@google/genai`) |
| Answer generation | Google Gemini `gemini-3.5-flash-lite` |
| Vector database | Qdrant (via `@qdrant/js-client-rest`) |
| Runs on | Local machine (`http://localhost:3000`) |

---

## Project flowchart

The full journey of one question, from opening the page to seeing the answer.

```text
  START: user opens http://localhost:3000
                        |
                        v
  +-------------------------------------------+
  | 1. BROWSER                                |
  | Choose a PDF, type a question,            |
  | click "Get answer"                        |
  +---------------------+---------------------+
                        |  POST /upload (PDF + question)
                        v
  +-------------------------------------------+
  | 2. EXPRESS SERVER                         |
  | Receives the request                      |
  | Multer saves a temporary file             |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 3. DECISION                               |
  | PDF and question provided?                |
  +---------------------+---------------------+
     NO  --> 400 error shown on the page --> END
                        |  YES
                        v
  +-------------------------------------------+
  | 4. Read the PDF                           |
  | Delete the temporary file                 |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 5. pdf-parse extracts the text            |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 6. DECISION                               |
  | Text found in the PDF?                    |
  +---------------------+---------------------+
     NO  --> 422 error shown on the page --> END
                        |  YES
                        v
  +-------------------------------------------+
  | 7. Split the text into chunks             |
  | (on blank lines)                          |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 8. GEMINI                                 |
  | Create an embedding for every chunk       |
  | (gemini-embedding-001)                    |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 9. QDRANT                                 |
  | Create collection pdf-docs if missing     |
  | (size 3072, Cosine)                       |
  | Store the chunks (batches of 50)          |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 10. GEMINI                                |
  | Create an embedding for the question      |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 11. QDRANT                                |
  | Search for the most similar chunk         |
  | (top 1)                                   |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 12. Build the prompt                      |
  | best chunk + question                     |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 13. GEMINI                                |
  | Generate the answer                       |
  | (gemini-3.5-flash-lite)                   |
  +---------------------+---------------------+
                        |
                        v
  +-------------------------------------------+
  | 14. EXPRESS SERVER                        |
  | Sends the answer text to the browser      |
  +---------------------+---------------------+
                        |  answer text
                        v
  +-------------------------------------------+
  | 15. BROWSER                               |
  | Shows the answer                          |
  +-------------------------------------------+
  END
```

If a Gemini or Qdrant call fails in steps 8 to 13, the server returns a 500 error and the page shows the error message.

---

## System architecture

How the parts of the project connect:

```text
  +------------------------------+
  |  Browser (the user)          |
  |  public/index.html           |
  +--------------+---------------+
                 |  POST /upload (PDF + question)
                 v
  +------------------------------+
  |  Express server (index.js)   |
  |  Multer + pdf-parse          |
  +------+---------------+-------+
         |               |
         | vectors,      | embeddings,
         | search        | answers
         v               v
  +-------------+  +------------------------+
  |  Qdrant     |  |  Gemini API            |
  |  pdf-docs   |  |  gemini-embedding-001  |
  |  collection |  |  gemini-3.5-flash-lite |
  +-------------+  +------------------------+
```

---

## Request flow

What happens, in order, when you click **Get answer**:

| # | From | To | What happens |
|---|---|---|---|
| 1 | User | Browser | Chooses a PDF and types a question |
| 2 | Browser | Express server | `POST /upload` (multipart form) |
| 3 | Express server | Express server | Reads the file and deletes the temporary copy |
| 4 | Express server | Express server | Extracts the text and splits it into chunks |
| 5 | Express server | Gemini | `embedContent` for every chunk, returns a vector of 3072 numbers |
| 6 | Express server | Qdrant | Creates `pdf-docs` if missing, then stores the points in batches of 50 |
| 7 | Express server | Gemini | `embedContent` for the question |
| 8 | Express server | Qdrant | `query` with limit 1, returns the best matching chunk |
| 9 | Express server | Gemini | `generateContent` with the chunk and the question, returns the answer |
| 10 | Express server | Browser | Returns the answer text |
| 11 | Browser | User | Shows the answer on the page |

---

## How data is stored in Qdrant

Every chunk of the PDF becomes one **point** in the `pdf-docs` collection:

```text
Collection: pdf-docs   (vector size 3072, distance: Cosine)
|
+-- Point  id: 1   vector: [3072 numbers]   payload: { "text": "chunk 1 ..." }
+-- Point  id: 2   vector: [3072 numbers]   payload: { "text": "chunk 2 ..." }
+-- Point  id: 3   vector: [3072 numbers]   payload: { "text": "chunk 3 ..." }
+-- ...
```

| Field | Value |
|---|---|
| Collection name | `pdf-docs` |
| Vector size | `3072` (default size of `gemini-embedding-001`) |
| Distance | Cosine similarity |
| Point id | Chunk position in the PDF (1, 2, 3, ...) |
| Payload | `{ "text": "<chunk text>" }` |

---

## Project structure

```text
rag_chat_bot_pdf/
├── .gitignore            # keeps .env, node_modules and uploads out of Git
├── README.md
└── server/
    ├── index.js          # Express server: upload, embeddings, Qdrant, Gemini
    ├── package.json
    ├── package-lock.json
    ├── .env              # secret keys (not pushed to GitHub)
    ├── uploads/          # temporary upload folder (created by Multer)
    └── public/
        └── index.html    # the web interface
```

---

## Getting started

### Prerequisites

- Node.js 18 or newer
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/)
- A free **Qdrant Cloud** cluster from [cloud.qdrant.io](https://cloud.qdrant.io/) (you need its URL and an API key)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/rag_chat_bot_pdf.git
cd rag_chat_bot_pdf/server
npm install
```

### Environment variables

Create a file named `.env` inside the `server` folder:

```env
GEMINI_API_KEY=your_gemini_api_key
QDRANT_URL=https://your-cluster-id.your-region.cloud.qdrant.io:6333
QDRANT_API_KEY=your_qdrant_api_key
```

Use no quotes and no spaces around `=`. The Qdrant URL must be the base address with the port, with nothing after it. Never commit this file.

### Run

```bash
npm run dev      # restarts automatically when you edit the code (nodemon)
npm start        # plain node
```

Open **http://localhost:3000**, choose a PDF, type a question and click **Get answer**.

The `pdf-docs` collection is created automatically the first time you upload a PDF.

---

## API reference

### `GET /`

Serves the web interface (`public/index.html`).

### `POST /upload`

Reads the PDF, stores its chunks in Qdrant and answers the question.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `pdf` | file | yes | The PDF to read |
| `question` | text | yes | The question to answer |

**Example**

```bash
curl -X POST http://localhost:3000/upload \
  -F "pdf=@GATE.pdf" \
  -F "question=What is the exam name?"
```

**Responses**

| Status | Body | Meaning |
|---|---|---|
| `200` | plain text | The answer |
| `400` | `{ "error": "No PDF uploaded (field name: 'pdf')" }` | The file is missing |
| `400` | `{ "error": "No question provided (field name: 'question')" }` | The question is missing |
| `422` | `{ "error": "No text found in PDF" }` | The PDF has no extractable text (for example, scanned images) |
| `500` | `{ "error": "<message>" }` | Gemini or Qdrant failed |

---

## Configuration

These values are set directly in `server/index.js`:

| Setting | Value | Notes |
|---|---|---|
| Port | `3000` | Can be changed with a `PORT` environment variable |
| Embedding model | `gemini-embedding-001` | Output size is 3072 by default |
| Answer model | `gemini-3.5-flash-lite` | Google renames and retires models often; check `ai.models.list()` if you get a 404 |
| Collection name | `pdf-docs` | |
| Vector size | `3072` | Must match the embedding size |
| Chunking | Split on blank lines (`\n\n`) | Empty chunks are removed |
| Chunks used as context | `1` | Change `limit` in `qdrant.query` to use more |
| Upsert batch size | `50` | Keeps each Qdrant request small |

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Cannot find module '...'` | A package is missing. Run `npm install` inside `server` |
| `Cannot GET /` | `public/index.html` is missing, or `express.static` is not set up before the routes |
| `EADDRINUSE: address already in use :::3000` | Another copy of the server is still running. Close it, or set a different `PORT` |
| `{"error": "Not Found"}` | Wrong `QDRANT_URL` (it must be the base URL with the port), or the collection does not exist |
| `qdrant.search is not a function` | Newer Qdrant client versions use `qdrant.query(...)`, as this project does |
| `404 NOT_FOUND` mentioning a model | Google retired that model name. Update the model in `index.js` |
| `429 RESOURCE_EXHAUSTED` | The Gemini free quota was reached. Wait, or try a shorter PDF |
| `Vector dimension error` | The collection size does not match the embedding size. Recreate it with size `3072` |
| `No text found in PDF` | The PDF is scanned images. It needs OCR first |
| Changes to `.env` are ignored | Restart the server. Type `rs` in the nodemon terminal |

---

## Limitations and future improvements

**Current limitations**

- Every upload embeds the whole PDF again, which is slow and uses Gemini quota
- Point ids are `1, 2, 3, ...`, so a new upload overwrites the previous PDF's first chunks, and extra chunks from a longer earlier PDF can remain in the collection
- Only the single best chunk is used, so answers that need several parts of the PDF may be incomplete
- Splitting on blank lines gives uneven chunks for some PDFs
- Scanned (image-only) PDFs are not supported
- There is no authentication, which is fine on localhost but should be added before the server is exposed to the internet

**Ideas for next steps**

- [ ] Split into two routes: `/upload` (store once, return a `docId`) and `/ask` (question and `docId`)
- [ ] Use unique point ids and filter searches by `docId` so several PDFs can live in one collection
- [ ] Embed chunks in batches instead of one request per chunk
- [ ] Chunk by size (about 500 to 1000 characters) with overlap
- [ ] Return the top 3 to 5 chunks as context and show the source text next to the answer
- [ ] Add a file size limit
- [ ] Support chat history for follow-up questions
- [ ] Add OCR for scanned PDFs

---

## License

ISC

## Author

Built by Sarthak Patel.
