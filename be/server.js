import app from "./src/app.js";
const PORT = process.env.PORT || 8000;

const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use. Stop the existing server and retry.`);
    process.exit(1);
  } else {
    throw err;
  }
});
