// environment.js

// If the app is running on localhost, use local backend. Otherwise, use prod.
const server = window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : "https://apnacollegebackend.onrender.com";

export default server;
