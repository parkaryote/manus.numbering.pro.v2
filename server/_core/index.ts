import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { serveStatic, setupVite } from "./vite";
import { createApp } from "./createApp";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(
  startPort: number = 3000,
  maxChecks: number = 200
): Promise<number> {
  for (let port = startPort; port < startPort + maxChecks; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found in range ${startPort}-${startPort + maxChecks - 1}`
  );
}

async function startServer() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Configure .env before running `pnpm dev`."
    );
  }

  const app = createApp();
  const server = createServer(app);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
