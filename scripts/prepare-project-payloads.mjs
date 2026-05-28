import * as fs from "node:fs";
import * as zlib from "node:zlib";

const projectsPath = "dist/projects.json";
const projectsJson = fs.readFileSync(projectsPath, "utf8");
const minifiedProjectsJson = JSON.stringify(JSON.parse(projectsJson));
const minifiedProjectsBuffer = Buffer.from(minifiedProjectsJson);
const gzipProjectsJson = zlib.gzipSync(minifiedProjectsBuffer, { level: 9 });

fs.writeFileSync(projectsPath, minifiedProjectsJson);
fs.writeFileSync(`${projectsPath}.gz`, gzipProjectsJson);

console.log(
    `Prepared project payloads: ${minifiedProjectsBuffer.length} bytes JSON, ${gzipProjectsJson.length} bytes gzip.`,
);
