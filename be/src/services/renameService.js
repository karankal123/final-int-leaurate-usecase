/**
 * Rename Service - Proxy to FastAPI rename service
 * 
 * Handles document renaming via the FastAPI microservice running on port 8001
 */

import axios from "axios";

const RENAME_SERVICE_URL = process.env.RENAME_SERVICE_URL || "http://localhost:8001";

/**
 * Rename student documents via FastAPI service
 * 
 * @param {string} studentName - Student's full name
 * @param {string} studentId - Student's ID
 * @returns {Promise<Object>} - Rename response from FastAPI
 */
export async function renameStudentDocuments(studentName, studentId) {
  const response = await axios.post(`${RENAME_SERVICE_URL}/rename/student`, {
    student_name: studentName,
    student_id: studentId,
  });
  return response.data;
}

/**
 * Health check for rename service
 * 
 * @returns {Promise<boolean>} - True if service is healthy
 */
export async function checkRenameServiceHealth() {
  try {
    const response = await axios.get(`${RENAME_SERVICE_URL}/docs`, { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}
