import { getUserById } from "../services/userService.js";

export const getUser = (req, res) => {
  const userId = req.params.id;

  try {
    const user = getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error in getUser:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
