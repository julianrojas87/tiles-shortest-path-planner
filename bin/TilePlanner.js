import Utils from "../lib/utils/Utils.js";
import { Command } from "commander";
import { fetch } from "undici";
import { parse as wktParse } from 'wellknown';
import { NetworkGraph, Dijkstra, AStar, NBAStar } from "../lib/index.js";

async function run() {
    const program = new Command()
        .requiredOption("-f, --from <from>", "Origin node identifier")
        .requiredOption("-t, --to <to>", "Destination node identifier")
        .requiredOption("-z, --zoom <zoom>", "Zoom level to be used for tiles")
        .requiredOption("--tiles <tiles>", "Tile interface URL")
        .option("--threshold <threshold>", "Maximum node count threshold allowed for the tile quadtree index")
        .option("-a, --algorithm <algorithm>", "Shortest path algorithm to be used (Dijkstra, A*, NBA*). Default is NBA*", "NBA*")
        .option("--node-weighted", "Indicates whether the cost of moving from one node to the next is given by each node (true) or given by the edge between 2 nodes (false)", false)
        .option("--debug", "Enable debug logs")
        .parse(process.argv);

    const logger = Utils.getLogger(program.opts().debug ? "debug" : "info");
    const tiles = program.opts().tiles.endsWith("/")
        ? program.opts().tiles.substring(0, program.opts().tiles.length - 1)
        : program.opts().tiles;

    let tilePlanner = null;

    // Check for valid tile interface
    if (!Utils.isValidHttpUrl(program.opts().tiles)) {
        logger.error(`Tile interface ${program.opts().tiles} is not a valid HTTP URL`);
        process.exit();
    }

    // Resolve locations of from and to nodes
    logger.debug("Resolving locations from location API");
    const locations = await Promise.all([
        (await fetch(`${tiles}/location?id=${encodeURIComponent(program.opts().from)}`)).json(),
        (await fetch(`${tiles}/location?id=${encodeURIComponent(program.opts().to)}`)).json()
    ]);
    const FROM = locations[0];
    const TO = locations[1];

    // Define cost function depending of the type of graph (node-weighted or edge-weighted).
    // If edge-weighted use the Harvesine distance as cost.
    // If node-weighted use the each node's cost.
    const distance = program.opts().nodeWeighted ? (node) => { return node.cost } : Utils.haversineDistance;

    FROM.coordinates = wktParse(FROM.wkt).coordinates;
    TO.coordinates = wktParse(TO.wkt).coordinates;
    logger.info(`Calculating route from ${FROM.label} to ${TO.label} using ${program.opts().algorithm} algorithm`);

    const NG = new NetworkGraph();

    switch (program.opts().algorithm) {
        case "Dijkstra":
            tilePlanner = new Dijkstra({
                NG,
                zoom: program.opts().zoom,
                tilesBaseURL: tiles,
                distance,
                logger
            });
            break;
        case "A*":
            tilePlanner = new AStar({
                NG,
                zoom: program.opts().zoom,
                tilesBaseURL: tiles,
                distance,
                heuristic: Utils.haversineDistance,
                logger
            });
            break;
        case "NBA*":
            tilePlanner = new NBAStar({
                NG,
                zoom: program.opts().zoom,
                tilesBaseURL: tiles,
                distance,
                heuristic: Utils.haversineDistance,
                logger
            });
    }

    // Load tile quadtree index (if available)
    await tilePlanner.loadTileQuadTree(program.opts().threshold)

    // Execute Shortest Path algorithm
    const shortestPath = await tilePlanner.findPath(FROM, TO);
    if (shortestPath) {
        const path = [];
        const linestring = [];
        shortestPath.path.forEach((p, i) => {
            path.push(`${i + 1}. ${p.id}`);
            linestring.push(`${p.coordinates[0]} ${p.coordinates[1]}`);
        });
        console.log("SHORTEST PATH found: ", JSON.stringify(path, null, 3));
        console.log(`LINESTRING(${linestring.join(",")})`);
        console.log("SHORTEST PATH metadata: ", shortestPath.metadata);
    } else {
        console.log("No path was found :(");
    }
}

run();