'use strict';
// How a booking's cameras are spread over its servers: 2 to a server, numbered 1, 2, 3… across the whole booking. Shared by the site
// (servers.js) and the control app, which gets a copy of this file when it's published (scripts/deploy-control.sh).
const CAMERAS_PER_SERVER = 2;

/** a booking's server n (1, 2…), with bookedCameras of the booking's cameras on it: how many it has, and the number its first goes by */
function bookedOn(n, bookedCameras) {
  return { cameras: Math.max(1, Math.min(CAMERAS_PER_SERVER, Number(bookedCameras) || CAMERAS_PER_SERVER)), first: ((n || 1) - 1) * CAMERAS_PER_SERVER + 1 };
}

module.exports = { CAMERAS_PER_SERVER, bookedOn };
