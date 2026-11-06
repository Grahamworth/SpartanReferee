// What a booking comes to: the same sums the site's API does, for showing before anyone presses Start. (Plain script; tests run it too.)
(function (root) {
  const serversFor = (cameras, perServer) => Math.ceil(cameras / perServer);
  const money = (v) => `£${v.toFixed(2)}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  /** { servers, cost, how }: how many servers those cameras need, and what they cost for that long */
  function quote(cameras, hours, price) {
    const servers = serversFor(cameras, price.camerasPerServer), cost = Math.round(cameras * hours * price.cameraHour * 100) / 100;
    return { servers, cost, how: `${plural(cameras, 'camera')} × ${plural(hours, 'hour')} × ${money(price.cameraHour)}` };
  }
  /** "in 3 hours 12 minutes" */
  function timeLeft(ms) {
    if (ms <= 0) return 'now';
    const mins = Math.ceil(ms / 60000), h = Math.floor(mins / 60), m = mins % 60;
    return `in ${h ? plural(h, 'hour') : ''}${h && m ? ' ' : ''}${m || !h ? plural(m, 'minute') : ''}`;
  }
  const api = { quote, timeLeft, money, plural };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HeadJudgeBooking = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
