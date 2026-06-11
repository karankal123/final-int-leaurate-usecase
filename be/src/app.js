import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import userRoutes from "./routes/userRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import uiCompatRoutes from "./routes/uiCompatRoutes.js";
import cors from "cors"
import { syncStatus } from "./jobs/statusSync.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Enable CORS for all origins (must be before other middleware)
app.use(cors());
app.use(express.json());

// Serve static documents from /documents endpoint
// Documents should be placed in be/documents/ folder
const documentsPath = path.join(__dirname, "..", "documents");
app.use("/documents", express.static(documentsPath));

setInterval(async () => {
    try {
        await syncStatus()
    } catch (err) {
        console.error("Status sync failed:", err.message)
    }
}, 30000)

app.use("/api/users", userRoutes);
app.use("/jobs", jobRoutes);
app.use("/", uiCompatRoutes);

export default app;
