import Utils from "../lib/utils/Utils.js";
import { Command } from "commander";
import fsPromise from "fs/promises";
import path from "path";
import { fetch } from "undici";
import { parse as wktParse } from 'wellknown';
import { Dijkstra, AStar } from "../lib/index.js";
import { NetworkGraph } from "../lib/model/NetworkGraph.js";

async function run() {
    const program = new Command()
        .requiredOption("-f, --from <from>", "Origin node identifier")
        .requiredOption("-t, --to <to>", "Destination node identifier")
        .requiredOption("-z, --zoom <zoom>", "Zoom level to be used for vector tiles")
        .requiredOption("--tiles <tiles>", "Tile interface URL")
        .option("-a, --algorithm <algorithm>", "Shortest path algorithm to be used (Dijkstra, A*, NBA*). Default is NBA*", "NBA*")
        .option("-i, --index <index>", "Path to local location index")
        .option("--debug", "Enable debug logs")
        .parse(process.argv);

    const logger = Utils.getLogger(program.opts().debug ? "debug" : "info");
    const tiles = program.opts().tiles.endsWith("/")
        ? program.opts().tiles.substring(0, program.opts().tiles.length - 1)
        : program.opts().tiles;
    let FROM = null;
    let TO = null;
    let algorithm = null;

    // Check for valid tile interface
    if (!Utils.isValidHttpUrl(program.opts().tiles)) {
        logger.error(`Tile interface ${program.opts().tiles} is not a valid HTTP URL`);
        process.exit();
    }

    // Resolve locations of from and to nodes
    if (program.opts().index) {
        logger.debug("Resolving locations from local index file");
        try {
            const index = new Map(JSON.parse(await fsPromise.readFile(path.resolve(program.opts().index))));
            FROM = index.get(program.opts().from);
            TO = index.get(program.opts().to);
        } catch (err) {
            logger.error(err);
            process.exit();
        }
    } else {
        logger.debug("Resolving locations from location API");
        const locations = await Promise.all([
            (await fetch(`${tiles}/location/${encodeURIComponent(program.opts().from)}`)).json(),
            (await fetch(`${tiles}/location/${encodeURIComponent(program.opts().to)}`)).json()
        ]);
        FROM = locations[0];
        TO = locations[1];
    }

    FROM.coordinates = wktParse(FROM.wkt).coordinates;
    TO.coordinates = wktParse(TO.wkt).coordinates;
    logger.info(`Calculating route from ${FROM.label} to ${TO.label} using ${program.opts().algorithm} algorithm`);


    switch (program.opts().algorithm) {
        case "Dijkstra":
            algorithm = new Dijkstra({
                NG: new NetworkGraph(),
                zoom: program.opts().zoom,
                tilesBaseURL: tiles,
                distance: (node) => { return node.length },
                logger
            });
            break;
        case "A*":
            algorithm = new AStar({
                NG: new NetworkGraph(),
                zoom: program.opts().zoom,
                tilesBaseURL: tiles,
                distance: (node) => { return node.length },
                heuristic: Utils.harvesineDistance,
                logger
            });
            break;
        default:
            process.exit();
    }

    // Execute Shortest Path algorithm
    const path = await algorithm.findPath(FROM, TO);
    console.log(path.map((p, i) => `${i + 1}. ${p.id}`));
}

run();