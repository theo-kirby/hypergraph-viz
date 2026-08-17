// ===========================================================================
// Blob tracing off the main thread. The field evaluation in blobOutline is
// the most expensive computation a state change triggers; running it here
// keeps transitions smooth on any machine. One message per refresh: a batch
// of requests in, a batch of loop lists out, matched by `id`.
// ===========================================================================

import { blobOutline } from "./blob.js";

onmessage = (e) => {
  const { id, jobs } = e.data;
  postMessage({ id, results: jobs.map((job) => blobOutline(job)) });
};
