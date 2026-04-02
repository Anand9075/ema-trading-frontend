import axios from "axios";

// ✅ Always point to your live backend (Render)
const BASE_URL = "https://ema-trading-backend.onrender.com";

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Request interceptor (optional debug)
api.interceptors.request.use(req => {
  console.log(`[API] ${req.method?.toUpperCase()} ${req.baseURL}${req.url}`);
  return req;
});

// Response interceptor
api.interceptors.response.use(
  res => res.data,
  err => {
    console.error("[API ERROR]:", err.response || err.message);
    throw err;
  }
);

// ===== APIs =====

export const tradeAPI = {
  getAll:     (status)   => api.get("/api/trades", { params: status ? { status } : {} }),
  create:     (data)     => api.post("/api/trades", data),
  update:     (id, data) => api.put(`/api/trades/${id}`, data),
  delete:     (id)       => api.delete(`/api/trades/${id}`),
  close:      (id, data) => api.post(`/api/trades/${id}/close`, data),
};

export const alertAPI = {
  getAll:      (since) => api.get("/api/alerts", { params: since ? { since } : {} }),
  markAllRead: ()      => api.put("/api/alerts/read-all"),
  delete:      (id)    => api.delete(`/api/alerts/${id}`),
};

export const priceAPI = {
  getAll:  ()        => api.get("/api/prices"),
  getOne:  (symbol)  => api.get(`/api/prices/${symbol}`),
};

export const strategyAPI = {
  runScan:  () => api.get("/api/strategy/run"),
  getPicks: () => api.get("/api/strategy/picks"),
};

export const configAPI = {
  get: () => api.get("/api/config"),
};

export default api;