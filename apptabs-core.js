// Which of the five tabs a company sees, and where each goes (apptabs.js draws them). Plain, so the tests can run it.
/** server: GET /api/servers/mine's server; hasBookings: they've booked before */
export function tabsFor(server, hasBookings) {
  const booked = !!server && server.wanted === 'on' && !server.scheduled; // on, or on its way
  const ready = booked && (server.servers || []).some((s) => s.state === 'on');
  return {
    // someone who's never booked sees only Booking
    show: { booking: true, live: booked, results: hasBookings || booked, cameras: booked, history: hasBookings },
    waiting: { live: booked && !ready, cameras: booked && !ready }, // starting: there, but nothing to open yet
    // Results is the video review's while a server is on, and the saved results (results.html) otherwise
    onServer: { live: true, cameras: true, results: ready },
  };
}
