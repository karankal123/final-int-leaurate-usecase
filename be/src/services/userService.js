// Mock user data
const users = [
  { id: "1", name: "Alice", email: "alice@example.com" },
  { id: "2", name: "Bob", email: "bob@example.com" },
];

export const getUserById = (id) => {
  return users.find((user) => user.id === id);
};
