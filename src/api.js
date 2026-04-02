import axios from "axios";

// FIX: Use environment variable so prod points to Render URL, dev to localhost
const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:4000";

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Request interceptor — log in development
api.interceptors.request.use(req => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[API] ${req.method?.toUpperCase()} ${req.url}`);
  }
  return req;
});

// Response interceptor — handle errors globally
api.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.error || err.message || "Unknown error";
    console.error(`[API Error] ${err.config?.url}: ${msg}`);
    throw new Error(msg);
  }
);

export const tradeAPI = {
  getAll:     (status)   => api.get("/api/trades", { params: status ? { status } : {} }),
  create:     (data)     => api.post("/api/trades", data),
  update:     (id, data) => api.put(`/api/trades/${id}`, data),
  delete:     (id)       => api.delete(`/api/trades/${id}`),
  close:      (id, data) => api.post(`/api/trades/${id}/close`, data),
};

export const alertAPI = {
  getAll:     (since)  => api.get("/api/alerts", { params: since ? { since } : {} }),
  markAllRead:()       => api.put("/api/alerts/read-all"),
  delete:     (id)     => api.delete(`/api/alerts/${id}`),
};

export const priceAPI = {
  getAll:     ()       => api.get("/api/prices"),
  getOne:     (symbol) => api.get(`/api/prices/${symbol}`),
};

export const strategyAPI = {
  runScan:    ()       => api.get("/api/strategy/run"),
  getPicks:   ()       => api.get("/api/strategy/picks"),
};

export const configAPI = {
  get:        ()       => api.get("/api/config"),
};

export default api;
