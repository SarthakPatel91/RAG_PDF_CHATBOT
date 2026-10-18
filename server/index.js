const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const { GoogleGenAI } = require("@google/genai");
const {QdrantClient}= require('@qdrant/js-client-rest');

require('dotenv').config();

const app = express();
const upload = multer({
  dest: path.join(__dirname, "uploads/"),
});

const ai=new GoogleGenAI({
    apiKey:process.env.GEMINI_API_KEY
})

async function createEmbedding(text){
const response=await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents:text
}); 

return response.embeddings[0].values;
}

const qdrant=new QdrantClient({
    url:process.env.QDRANT_URL,
    apiKey:process.env.QDRANT_API_KEY
})

app.use(express.static(path.join(__dirname, "public")));   // CHANGED: serves public/index.html at "/"

app.post("/upload", upload.single("pdf"), async (req, res) => {
  console.log(req.file);

  if (!req.file) {
    return res.status(400).json({ error: "No PDF uploaded (field name: 'pdf')" });
  }

  const question= req.body.question;
  if (!question || !question.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "No question provided (field name: 'question')" });
  }

  try{
    const dataBuffer=fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);
    const pdfData=await pdfParse(dataBuffer);
    const text=pdfData.text;

    const chunks=text.split('\n\n').filter((chunk)=>chunk.trim()!='');

    if (chunks.length === 0) {
      return res.status(422).json({ error: "No text found in PDF" });
    }
    
    const chunkembedding=[];
    for(const chunk of chunks){
        const embedding=await createEmbedding(chunk);

        chunkembedding.push({
            text:chunk,
            embedding
        })
    }

    const {exists}=await qdrant.collectionExists("pdf-docs");
    if(!exists){
        await qdrant.createCollection("pdf-docs",{
            vectors:{size:3072,distance:"Cosine"}
        });
    }

    const points=chunkembedding.map((item,index)=>({
        id:index+1,
        vector:item.embedding,
        payload:{
            text:item.text
        },
    }));

    for(let i=0;i<points.length;i+=50){
        await qdrant.upsert("pdf-docs",{
            wait:true,
            points:points.slice(i,i+50)
        });
    }

    const quesitonEmbedding=await createEmbedding(question);

    const searchResult=await qdrant.query('pdf-docs',{
        query:quesitonEmbedding,
        limit:1,
        with_payload:true
    })

    const bestChunk=searchResult.points[0].payload.text;
     
    console.log(searchResult.points[0].score);
    
    const response=await ai.models.generateContent({
        model:'gemini-3.5-flash-lite',
        contents:`Answer the question using only the context below.\n\nContext:\n${bestChunk}\n\nQuestion: ${question}`
    })

    res.send(response.text);

  }catch(err){
    console.log(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;                      // CHANGED: Render sets the port
app.listen(PORT, () => {
  console.log("Server is listening on port " + PORT);
});