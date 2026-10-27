function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || 500;
  
  // Safe sanitized error response
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error',
    errorCode: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
}

// In-memory bucket rate limiter for sensitive endpoints
const requestBuckets = new Map();

function rateLimiter({ maxRequests = 60, windowSeconds = 60 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    let bucket = requestBuckets.get(ip);
    if (!bucket || now - bucket.startTime > windowMs) {
      bucket = { startTime: now, count: 1 };
      requestBuckets.set(ip, bucket);
    } else {
      bucket.count++;
    }

    if (bucket.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Rate limit exceeded.',
        errorCode: 'RATE_LIMIT_EXCEEDED'
      });
    }

    next();
  };
}

module.exports = {
  errorHandler,
  rateLimiter
};
