// Which of the five tabs a company sees, and where each goes (apptabs.js draws them). Plain, so the tests can run it.
/** server: GET /api/servers/mine's server; hasBookings: they've booked before; active: the tab being shown, which always shows */
export function tabsFor(server, hasBookings, active = 'booking') {
  const booked = !!server && server.wanted === 'on' && !server.scheduled; // on, or on its way
  const ready = booked && (server.servers || []).some((s) => s.state === 'on');
  return {
    // someone who's never booked sees only Booking (and whichever they've gone to, say History from the test review)
    show: { booking: true, live: booked, results: hasBookings || booked || active === 'results', cameras: booked, history: hasBookings || active === 'history' },
    waiting: { live: booked && !ready, cameras: booked && !ready }, // starting: there, but nothing to open yet
    // Results is the video review's while a server is on, and the saved results (results.html) otherwise
    onServer: { live: true, cameras: true, results: ready },
  };
}
