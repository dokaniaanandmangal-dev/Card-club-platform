export class WebSocketAbuseGuard {
  constructor({
    maxConnectionsPerSubject = 4,
    maxFrameBytes = 64 * 1024,
    maxMessagesPerWindow = 120,
    windowMs = 10_000,
    maxInFlight = 8,
  } = {}) {
    this.maxConnectionsPerSubject = maxConnectionsPerSubject;
    this.maxFrameBytes = maxFrameBytes;
    this.maxMessagesPerWindow = maxMessagesPerWindow;
    this.windowMs = windowMs;
    this.maxInFlight = maxInFlight;
    this.connections = new Map();
    this.subjectConnections = new Map();
  }

  open({ subject, connectionId, now = Date.now() }) {
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 128) {
      return { allowed: false, code: 'invalid_subject' };
    }
    if (typeof connectionId !== 'string' || connectionId.length < 8 || connectionId.length > 128) {
      return { allowed: false, code: 'invalid_connection_id' };
    }
    if (this.connections.has(connectionId)) return { allowed: false, code: 'duplicate_connection_id' };

    const active = this.subjectConnections.get(subject) ?? new Set();
    if (active.size >= this.maxConnectionsPerSubject) {
      return { allowed: false, code: 'connection_limit' };
    }

    active.add(connectionId);
    this.subjectConnections.set(subject, active);
    this.connections.set(connectionId, {
      subject,
      windowStart: now,
      messages: 0,
      inFlight: 0,
    });
    return { allowed: true };
  }

  inspectFrame({ connectionId, bytes, now = Date.now() }) {
    const state = this.connections.get(connectionId);
    if (!state) return { allowed: false, code: 'unknown_connection' };
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > this.maxFrameBytes) {
      return { allowed: false, code: 'frame_too_large' };
    }
    if (now < state.windowStart || now - state.windowStart >= this.windowMs) {
      state.windowStart = now;
      state.messages = 0;
    }
    if (state.messages >= this.maxMessagesPerWindow) {
      return { allowed: false, code: 'message_rate_limit' };
    }
    if (state.inFlight >= this.maxInFlight) {
      return { allowed: false, code: 'backpressure_limit' };
    }

    state.messages += 1;
    state.inFlight += 1;
    return { allowed: true, inFlight: state.inFlight };
  }

  completeFrame(connectionId) {
    const state = this.connections.get(connectionId);
    if (!state || state.inFlight === 0) return false;
    state.inFlight -= 1;
    return true;
  }

  close(connectionId) {
    const state = this.connections.get(connectionId);
    if (!state) return false;
    this.connections.delete(connectionId);
    const active = this.subjectConnections.get(state.subject);
    active?.delete(connectionId);
    if (active?.size === 0) this.subjectConnections.delete(state.subject);
    return true;
  }
}
