import multer from "multer";

export const upload = multer({
  storage: multer.memoryStorage(), // IMPORTANT
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

