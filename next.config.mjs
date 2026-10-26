/** @type {import('next').NextConfig} */
export default {
  // The proxy in front compresses; leaving it to the proxy keeps the event stream unbuffered.
  compress: false,
};
