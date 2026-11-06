#pragma once
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <functional>
#include <limits>
#include <mutex>
#include <thread>
#include <vector>

namespace corridor {

struct Texture {
  int levels = 0;
  int width[16] = {0};
  int height[16] = {0};
  std::vector<uint32_t> data[16];
  bool cutout = false;
  bool wrap = false;
  bool shadow = false;
  bool blend = false;
  bool sharp = false;
  bool nearest = false;
  std::atomic<bool> ready{true};

  void build(const uint32_t* pixels, int w, int h) {
    width[0] = w;
    height[0] = h;
    data[0].assign(pixels, pixels + size_t(w) * h);
    levels = 1;
    while ((width[levels - 1] > 1 || height[levels - 1] > 1) && levels < 16) {
      int pw = width[levels - 1], ph = height[levels - 1];
      int nw = std::max(1, pw / 2), nh = std::max(1, ph / 2);
      std::vector<uint32_t>& out = data[levels];
      out.resize(size_t(nw) * nh);
      const std::vector<uint32_t>& in = data[levels - 1];
      for (int y = 0; y < nh; y++)
        for (int x = 0; x < nw; x++) {
          uint32_t s[4] = {in[size_t(std::min(2 * y, ph - 1)) * pw + std::min(2 * x, pw - 1)],
                           in[size_t(std::min(2 * y, ph - 1)) * pw + std::min(2 * x + 1, pw - 1)],
                           in[size_t(std::min(2 * y + 1, ph - 1)) * pw + std::min(2 * x, pw - 1)],
                           in[size_t(std::min(2 * y + 1, ph - 1)) * pw + std::min(2 * x + 1, pw - 1)]};
          uint32_t r = 0, g = 0, b = 0, a = 0, n = 0;
          for (uint32_t t : s) {
            uint32_t ta = t >> 24;
            a += ta;
            if (ta == 0 && cutout) continue;
            r += t & 255;
            g += (t >> 8) & 255;
            b += (t >> 16) & 255;
            n++;
          }
          if (n == 0) n = 1;
          out[size_t(y) * nw + x] = (r / n) | ((g / n) << 8) | ((b / n) << 16) | ((a / 4) << 24);
        }
      width[levels] = nw;
      height[levels] = nh;
      levels++;
    }
  }
};

struct Cluster {
  int firstIndex = 0, indexCount = 0, firstVertex = 0, vertexCount = 0;
  float lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
};

struct Mesh {
  std::vector<Cluster> clusters;
  const float* positions = nullptr;
  const float* normals = nullptr;
  const float* uvs = nullptr;
  const uint32_t* colours = nullptr;
  const uint32_t* indices = nullptr;
  int vertexCount = 0;
  int indexCount = 0;
  const Texture* texture = nullptr;
  float tint[3] = {1, 1, 1};
  bool cull = false;
  float bias = 1;
  float lo[3] = {0, 0, 0};
  float hi[3] = {0, 0, 0};

  void bound() {
    for (int c = 0; c < 3; c++) {
      lo[c] = 1e30f;
      hi[c] = -1e30f;
    }
    for (int v = 0; v < vertexCount; v++)
      for (int c = 0; c < 3; c++) {
        lo[c] = std::min(lo[c], positions[v * 3 + c]);
        hi[c] = std::max(hi[c], positions[v * 3 + c]);
      }
    clusters.clear();
    const int span = 512 * 3;
    for (int first = 0; first < indexCount; first += span) {
      Cluster cl;
      cl.firstIndex = first;
      cl.indexCount = std::min(span, indexCount - first);
      uint32_t vmin = ~0u, vmax = 0;
      for (int i = first; i < first + cl.indexCount; i++) {
        vmin = std::min(vmin, indices[i]);
        vmax = std::max(vmax, indices[i]);
      }
      cl.firstVertex = int(vmin);
      cl.vertexCount = int(vmax - vmin + 1);
      for (int c = 0; c < 3; c++) {
        cl.lo[c] = 1e30f;
        cl.hi[c] = -1e30f;
      }
      for (int i = first; i < first + cl.indexCount; i++)
        for (int c = 0; c < 3; c++) {
          cl.lo[c] = std::min(cl.lo[c], positions[indices[i] * 3 + c]);
          cl.hi[c] = std::max(cl.hi[c], positions[indices[i] * 3 + c]);
        }
      clusters.push_back(cl);
    }
  }
};

struct Sky {
  float zenith[3] = {70, 138, 226};
  float horizon[3] = {196, 222, 244};
};

struct Lighting {
  float sun[3] = {0, 1, 0};
  float sunColour[3] = {1, 1, 1};
  float skyColour[3] = {0.4f, 0.45f, 0.5f};
  float groundColour[3] = {0.2f, 0.2f, 0.2f};
};

class Pool {
 public:
  explicit Pool(int threads) {
    for (int t = 0; t < threads; t++) workers.emplace_back([this] { loop(); });
  }
  ~Pool() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      stopping = true;
      generation++;
    }
    wake.notify_all();
    for (auto& w : workers) w.join();
  }
  int size() const { return int(workers.size()) + 1; }
  void run(int count, const std::function<void(int)>& work) {
    {
      std::lock_guard<std::mutex> lock(mutex);
      job = &work;
      jobCount = count;
      next = 0;
      active = int(workers.size());
      generation++;
    }
    wake.notify_all();
    drain();
    std::unique_lock<std::mutex> lock(mutex);
    done.wait(lock, [this] { return active == 0; });
    job = nullptr;
  }

 private:
  void drain() {
    for (int i = next++; i < jobCount; i = next++) (*job)(i);
  }
  void loop() {
    uint64_t seen = 0;
    for (;;) {
      {
        std::unique_lock<std::mutex> lock(mutex);
        wake.wait(lock, [&] { return generation != seen; });
        seen = generation;
        if (stopping) return;
      }
      drain();
      {
        std::lock_guard<std::mutex> lock(mutex);
        if (--active == 0) done.notify_one();
      }
    }
  }
  std::vector<std::thread> workers;
  std::mutex mutex;
  std::condition_variable wake, done;
  const std::function<void(int)>* job = nullptr;
  std::atomic<int> next{0};
  int jobCount = 0;
  int active = 0;
  uint64_t generation = 0;
  bool stopping = false;
};

struct Triangle {
  float e0[3], e1[3], e2[3];
  float q[3], u[3], v[3];
  int minX, minY, maxX, maxY;
  const Texture* texture;
  uint32_t tintPacked;
  float bias;
  bool tinted;
  bool uniform;
  uint32_t flat;
  int lit;
  int mode;
};

typedef float lanes __attribute__((vector_size(16)));

struct Shade {
  lanes lightX, lightY, light0;
};

struct Stats {
  int triangles = 0;
  int binned = 0;
  std::atomic<long> tested{0}, shaded{0}, rows{0};
  double transformMs = 0;
  double rasterMs = 0;
};

class Renderer {
 public:
  static constexpr int smallTile = 64;
  static constexpr int largeTile = 128;
  static constexpr int largeTileLines = 1200;
  static constexpr int skyBlock = 8;
  int tile = smallTile;
  explicit Renderer(int threads) : pool(std::max(0, threads - 1)) {}

  void resize(int w, int h) {
    width = w;
    height = h;
    colour.assign(size_t(w) * h + 8, 0);
    depth.assign(size_t(w) * h + 8, 0.0f);
    tile = h > largeTileLines ? largeTile : smallTile;
    tilesX = (w + tile - 1) / tile;
    tilesY = (h + tile - 1) / tile;
  }

  void begin(const float* viewProjection, const float* rayCorner, const float* rayRight,
             const float* rayDown, const Lighting* light = nullptr) {
    std::memcpy(vp, viewProjection, sizeof vp);
    std::memcpy(corner, rayCorner, sizeof corner);
    std::memcpy(right, rayRight, sizeof right);
    std::memcpy(down, rayDown, sizeof down);
    if (light) lighting = *light;
    work.clear();
    draws.clear();
    stats.triangles = 0;
    stats.binned = 0;
    stats.tested = 0;
    stats.shaded = 0;
    stats.rows = 0;
    stats.transformMs = 0;
    stats.rasterMs = 0;
  }

  void draw(const Mesh& m, const float* model = nullptr) {
    if (!m.colours && (!m.texture || !m.texture->ready.load(std::memory_order_acquire))) return;
    Draw d;
    d.mesh = &m;
    d.placed = model != nullptr;
    d.cull = 0;
    if (m.cull) {
      const float* r = model;
      const float det = model ? r[0] * (r[5] * r[10] - r[6] * r[9]) - r[4] * (r[1] * r[10] - r[2] * r[9]) +
                                    r[8] * (r[1] * r[6] - r[2] * r[5])
                              : 1.0f;
      d.cull = det < 0 ? -1 : 1;
    }
    if (model) {
      std::memcpy(d.model, model, sizeof d.model);
      multiply(vp, model, d.mvp);
    } else {
      std::memcpy(d.mvp, vp, sizeof d.mvp);
    }
    if (!visibleBox(m.lo, m.hi, d.mvp)) return;
    const int index = int(draws.size());
    draws.push_back(d);
    for (size_t c = 0; c < m.clusters.size(); c++) work.push_back({index, int(c)});
  }

  void finish() {
    auto started = now();
    if (outputs.size() < work.size()) outputs.resize(work.size());
    pool.run(int(work.size()), [&](int k) { setupCluster(k); });
    std::vector<uint32_t>& counts = tileCounts;
    counts.assign(size_t(tilesX) * tilesY + 1, 0);
    for (size_t k = 0; k < work.size(); k++)
      for (const Ref& r : outputs[k].refs) counts[r.tile + 1]++;
    for (size_t i = 1; i < counts.size(); i++) counts[i] += counts[i - 1];
    tileRefs.resize(counts.back());
    std::vector<uint32_t> fill(counts.begin(), counts.end() - 1);
    for (size_t k = 0; k < work.size(); k++)
      for (const Ref& r : outputs[k].refs) tileRefs[fill[r.tile]++] = {uint32_t(k), r.triangle};
    for (size_t k = 0; k < work.size(); k++) {
      stats.triangles += int(outputs[k].tris.size());
      stats.binned += int(outputs[k].refs.size());
    }
    auto binned = now();
    stats.transformMs = (binned - started) * 1000;
    const size_t tileCount = size_t(tilesX) * tilesY;
    if (tileCost.size() != tileCount) tileCost.assign(tileCount, 0.0);
    tileOrder.resize(tileCount);
    for (size_t i = 0; i < tileCount; i++) tileOrder[i] = uint32_t(i);
    std::sort(tileOrder.begin(), tileOrder.end(), [&](uint32_t a, uint32_t b) { return tileCost[a] > tileCost[b]; });
    pool.run(int(tileCount), [&](int k) {
      const uint32_t index = tileOrder[size_t(k)];
      const double c = now();
      rasterTile(int(index));
      tileCost[index] = now() - c;
    });
    stats.rasterMs = (now() - binned) * 1000;
  }

  const uint32_t* pixels() const { return colour.data(); }
  void hand(std::vector<uint32_t>& shown) {
    colour.swap(shown);
    if (colour.size() != shown.size()) colour.assign(shown.size(), 0);
  }
  int frameWidth() const { return width; }
  int frameHeight() const { return height; }
  Stats stats;

 private:
  static double now() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
  }

  static void multiply(const float* a, const float* b, float* out) {
    for (int c = 0; c < 4; c++)
      for (int r = 0; r < 4; r++) {
        float sum = 0;
        for (int k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = sum;
      }
  }

  static bool visibleBox(const float* lo, const float* hi, const float* m) {
    for (int p = 0; p < 6; p++) {
      const int row = p >> 1;
      const float sign = (p & 1) ? -1.0f : 1.0f;
      if (p >= 4 && sign > 0) continue;
      float a = m[3] + sign * m[row], b = m[7] + sign * m[4 + row], c = m[11] + sign * m[8 + row],
            d = m[15] + sign * m[12 + row];
      float x = a >= 0 ? hi[0] : lo[0];
      float y = b >= 0 ? hi[1] : lo[1];
      float z = c >= 0 ? hi[2] : lo[2];
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  }

  struct Ref {
    uint32_t tile;
    uint32_t triangle;
  };
  struct Draw {
    const Mesh* mesh;
    float mvp[16];
    float model[16];
    bool placed;
    int cull;
  };
  struct WorkItem {
    int draw;
    int cluster;
  };
  struct ClusterOutput {
    std::vector<Triangle> tris;
    std::vector<Shade> shades;
    std::vector<Ref> refs;
    std::vector<float> clip;
    std::vector<float> lit;
    int cull = 0;
  };
  struct TileRef {
    uint32_t item;
    uint32_t triangle;
  };
  static constexpr int attributes = 3;
  static constexpr float referenceAlbedo = 0.35f;
  static constexpr float referenceShade = 160.0f;
  static constexpr float sharpBias = 0.5f;
  static constexpr float uniformSpread = 2.0f;
  static constexpr int encodeSteps = 4096;

  void shadeVertices(const Draw& d, const Cluster& cl, ClusterOutput& out) {
    const Mesh& m = *d.mesh;
    const Lighting& L = lighting;
    const float* M = d.model;
    for (int v = 0; v < cl.vertexCount; v++) {
      const float* n0 = m.normals + size_t(cl.firstVertex + v) * 3;
      float n[3];
      for (int r = 0; r < 3; r++) n[r] = M[r] * n0[0] + M[4 + r] * n0[1] + M[8 + r] * n0[2];
      float nl = std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
      nl = nl > 1e-12f ? 1.0f / nl : 0.0f;
      for (float& c : n) c *= nl;
      const float up = 0.5f + 0.5f * n[1];
      const float facing = std::max(0.0f, n[0] * L.sun[0] + n[1] * L.sun[1] + n[2] * L.sun[2]);
      lanes light;
      for (int c = 0; c < 3; c++)
        light[c] = L.skyColour[c] * up + L.groundColour[c] * (1 - up) + L.sunColour[c] * facing;
      light[3] = 0;
      const lanes base = toneMapped(light * referenceAlbedo);
      float* o = &out.lit[size_t(v) * attributes];
      for (int c = 0; c < 3; c++) o[c] *= base[c] / referenceShade;
    }
  }

  static lanes toneMapped(lanes value) {
    static const lanes acesIn[3] = {{0.59719f, 0.07600f, 0.02840f, 0.0f},
                                    {0.35458f, 0.90834f, 0.13383f, 0.0f},
                                    {0.04823f, 0.01566f, 0.83777f, 0.0f}};
    static const lanes acesOut[3] = {{1.60475f, -0.10208f, -0.00327f, 0.0f},
                                     {-0.53108f, 1.10813f, -0.07276f, 0.0f},
                                     {-0.07367f, -0.00605f, 1.07602f, 0.0f}};
    const lanes graded = acesIn[0] * value[0] + acesIn[1] * value[1] + acesIn[2] * value[2];
    const lanes fitted = (graded * (graded + 0.0245786f) - 0.000090537f) /
                         (graded * (graded * 0.983729f + 0.4329510f) + 0.238081f);
    lanes mapped = acesOut[0] * fitted[0] + acesOut[1] * fitted[1] + acesOut[2] * fitted[2];
    static const std::vector<float> encoded = [] {
      std::vector<float> table(encodeSteps + 1);
      for (int i = 0; i <= encodeSteps; i++) {
        const float m = float(i) / encodeSteps;
        table[size_t(i)] = 255.0f * (m <= 0.0031308f ? m * 12.92f : 1.055f * std::pow(m, 1 / 2.4f) - 0.055f);
      }
      return table;
    }();
    lanes result;
    for (int c = 0; c < 4; c++)
      result[c] = encoded[size_t(std::clamp(mapped[c], 0.0f, 1.0f) * encodeSteps + 0.5f)];
    return result;
  }

  void setupCluster(int k) {
    ClusterOutput& out = outputs[size_t(k)];
    out.tris.clear();
    out.shades.clear();
    out.refs.clear();
    const Draw& d = draws[size_t(work[size_t(k)].draw)];
    const Mesh& m = *d.mesh;
    const Cluster& cl = m.clusters[size_t(work[size_t(k)].cluster)];
    const float* M = d.mvp;
    if (!visibleBox(cl.lo, cl.hi, M)) return;
    out.clip.resize(size_t(cl.vertexCount) * 4);
    for (int v = 0; v < cl.vertexCount; v++) {
      const float* p = m.positions + size_t(cl.firstVertex + v) * 3;
      float* o = &out.clip[size_t(v) * 4];
      for (int r = 0; r < 4; r++) o[r] = M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r];
    }
    const bool paint = m.colours != nullptr;
    const bool lit = paint && m.normals != nullptr && d.placed;
    const Texture* texture = m.texture;
    out.cull = d.cull;
    if (paint) paintVertices(m, cl, out);
    if (lit) shadeVertices(d, cl, out);
    uint32_t tint = uint32_t(std::clamp(m.tint[0], 0.0f, 4.0f) * 64) |
                    (uint32_t(std::clamp(m.tint[1], 0.0f, 4.0f) * 64) << 10) |
                    (uint32_t(std::clamp(m.tint[2], 0.0f, 4.0f) * 64) << 20);
    bool tinted = m.tint[0] != 1 || m.tint[1] != 1 || m.tint[2] != 1;
    const Style style = {texture, tint, m.bias, tinted, paint ? 2 : 0};
    static const float none[attributes] = {0, 0, 0};
    static const float flat[2] = {0, 0};
    for (int i = cl.firstIndex; i + 2 < cl.firstIndex + cl.indexCount; i += 3) {
      uint32_t ia = m.indices[i], ib = m.indices[i + 1], ic = m.indices[i + 2];
      if (ia == ib || ib == ic || ia == ic) continue;
      const float* c[3] = {&out.clip[size_t(ia - cl.firstVertex) * 4], &out.clip[size_t(ib - cl.firstVertex) * 4],
                           &out.clip[size_t(ic - cl.firstVertex) * 4]};
      const float* t[3] = {flat, flat, flat};
      if (m.uvs) {
        t[0] = m.uvs + ia * 2;
        t[1] = m.uvs + ib * 2;
        t[2] = m.uvs + ic * 2;
      }
      const float* a[3] = {none, none, none};
      if (paint) {
        a[0] = &out.lit[size_t(ia - cl.firstVertex) * attributes];
        a[1] = &out.lit[size_t(ib - cl.firstVertex) * attributes];
        a[2] = &out.lit[size_t(ic - cl.firstVertex) * attributes];
      }
      int behind = 0;
      for (int j = 0; j < 3; j++) behind += c[j][3] < nearW ? 1 : 0;
      if (behind == 3) continue;
      if (behind > 0) {
        clipNear(out, c, t, a, style);
        continue;
      }
      float x[3], y[3], w[3];
      for (int j = 0; j < 3; j++) {
        w[j] = c[j][3];
        x[j] = c[j][0] / w[j];
        y[j] = c[j][1] / w[j];
      }
      emit(out, x, y, w, t, a, style);
    }
  }

  void paintVertices(const Mesh& m, const Cluster& cl, ClusterOutput& out) {
    out.lit.resize(size_t(cl.vertexCount) * attributes);
    for (int v = 0; v < cl.vertexCount; v++) {
      const uint32_t colour = m.colours[cl.firstVertex + v];
      float* o = &out.lit[size_t(v) * attributes];
      o[0] = float(colour & 255);
      o[1] = float((colour >> 8) & 255);
      o[2] = float((colour >> 16) & 255);
    }
  }

  struct Style {
    const Texture* texture;
    uint32_t tint;
    float bias;
    bool tinted;
    int mode;
  };

  void clipNear(ClusterOutput& out, const float* const c[3], const float* const t[3], const float* const a[3],
                const Style& style) {
    float poly[8][5 + attributes];
    int count = 0;
    for (int k = 0; k < 3; k++) {
      const int j = (k + 1) % 3;
      const float* p = c[k];
      const float* q = c[j];
      bool inp = p[3] >= nearW, inq = q[3] >= nearW;
      if (inp) {
        float* o = poly[count++];
        o[0] = p[0];
        o[1] = p[1];
        o[2] = p[3];
        o[3] = t[k][0];
        o[4] = t[k][1];
        for (int n = 0; n < attributes; n++) o[5 + n] = a[k][n];
      }
      if (inp != inq) {
        float f = (nearW - p[3]) / (q[3] - p[3]);
        float* o = poly[count++];
        o[0] = p[0] + (q[0] - p[0]) * f;
        o[1] = p[1] + (q[1] - p[1]) * f;
        o[2] = nearW;
        o[3] = t[k][0] + (t[j][0] - t[k][0]) * f;
        o[4] = t[k][1] + (t[j][1] - t[k][1]) * f;
        for (int n = 0; n < attributes; n++) o[5 + n] = a[k][n] + (a[j][n] - a[k][n]) * f;
      }
    }
    for (int k = 1; k + 1 < count; k++) {
      int idx[3] = {0, k, k + 1};
      float x[3], y[3], w[3];
      const float* tt[3];
      const float* aa[3];
      for (int j = 0; j < 3; j++) {
        w[j] = poly[idx[j]][2];
        x[j] = poly[idx[j]][0] / w[j];
        y[j] = poly[idx[j]][1] / w[j];
        tt[j] = &poly[idx[j]][3];
        aa[j] = &poly[idx[j]][5];
      }
      emit(out, x, y, w, tt, aa, style);
    }
  }

  void emit(ClusterOutput& out, const float x[3], const float y[3], const float w[3], const float* const t[3],
            const float* const a[3], const Style& style) {
    float sx[3], sy[3];
    for (int k = 0; k < 3; k++) {
      sx[k] = (x[k] * 0.5f + 0.5f) * width;
      sy[k] = (0.5f - y[k] * 0.5f) * height;
    }
    float area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (std::fabs(area) < 1e-6f || float(out.cull) * area > 0) return;
    float minX = std::min({sx[0], sx[1], sx[2]}), maxX = std::max({sx[0], sx[1], sx[2]});
    float minY = std::min({sy[0], sy[1], sy[2]}), maxY = std::max({sy[0], sy[1], sy[2]});
    if (maxX < 0 || maxY < 0 || minX >= width || minY >= height) return;
    Triangle tri;
    tri.minX = std::max(0, int(std::floor(minX)));
    tri.minY = std::max(0, int(std::floor(minY)));
    tri.maxX = std::min(width - 1, int(std::ceil(maxX)));
    tri.maxY = std::min(height - 1, int(std::ceil(maxY)));
    if (tri.minX > tri.maxX || tri.minY > tri.maxY) return;
    float inv = 1.0f / area;
    int o = area > 0 ? 0 : 1;
    int i1 = o == 0 ? 1 : 2, i2 = o == 0 ? 2 : 1;
    float px[3] = {sx[0], sx[i1], sx[i2]}, py[3] = {sy[0], sy[i1], sy[i2]};
    auto edge = [&](int a, int b, float* e) {
      e[0] = py[a] - py[b];
      e[1] = px[b] - px[a];
      e[2] = px[a] * py[b] - px[b] * py[a];
    };
    edge(1, 2, tri.e0);
    edge(2, 0, tri.e1);
    edge(0, 1, tri.e2);
    if (maxX - minX < 2 && maxY - minY < 2 && !coversCentre(tri, minX, maxX, minY, maxY)) return;
    float q[3], u[3], v[3];
    for (int k = 0; k < 3; k++) {
      q[k] = 1.0f / w[k];
      u[k] = t[k][0] * q[k];
      v[k] = t[k][1] * q[k];
    }
    auto plane = [&](const float* values, float* result) {
      float d1 = values[1] - values[0], d2 = values[2] - values[0];
      float ex1 = sx[1] - sx[0], ey1 = sy[1] - sy[0], ex2 = sx[2] - sx[0], ey2 = sy[2] - sy[0];
      result[0] = (d1 * ey2 - d2 * ey1) * inv;
      result[1] = (d2 * ex1 - d1 * ex2) * inv;
      result[2] = values[0] - result[0] * sx[0] - result[1] * sy[0];
    };
    plane(q, tri.q);
    if (style.mode != 2) {
      plane(u, tri.u);
      plane(v, tri.v);
    } else {
      std::fill(tri.u, tri.u + 3, 0.0f);
      std::fill(tri.v, tri.v + 3, 0.0f);
    }
    tri.texture = style.texture;
    tri.tintPacked = style.tint;
    tri.bias = style.bias;
    tri.tinted = style.tinted;
    tri.lit = -1;
    tri.mode = style.mode;
    tri.uniform = false;
    tri.flat = 0;
    if (style.mode == 2) {
      float spread = 0;
      for (int n = 0; n < 3; n++)
        spread = std::max({spread, std::fabs(a[0][n] - a[1][n]), std::fabs(a[0][n] - a[2][n])});
      if (spread <= uniformSpread) {
        tri.uniform = true;
        for (int n = 0; n < 3; n++) {
          const float mean = std::clamp((a[0][n] + a[1][n] + a[2][n]) / 3.0f, 0.0f, 255.0f);
          tri.flat |= uint32_t(mean + 0.5f) << (8 * n);
        }
        tri.flat |= 0xff000000u;
      }
      Shade shade = {};
      for (int n = 0; n < 3; n++) {
        float l[3] = {a[0][n], a[1][n], a[2][n]};
        float lp[3];
        plane(l, lp);
        shade.lightX[n] = lp[0];
        shade.lightY[n] = lp[1];
        shade.light0[n] = lp[2];
      }
      tri.lit = int(out.shades.size());
      out.shades.push_back(shade);
    }
    uint32_t id = uint32_t(out.tris.size());
    out.tris.push_back(tri);
    for (int ty = tri.minY / tile; ty <= tri.maxY / tile; ty++)
      for (int tx = tri.minX / tile; tx <= tri.maxX / tile; tx++) out.refs.push_back({uint32_t(ty * tilesX + tx), id});
  }

  static bool coversCentre(const Triangle& t, float minX, float maxX, float minY, float maxY) {
    for (float y = std::ceil(minY - 0.5f) + 0.5f; y <= maxY; y += 1)
      for (float x = std::ceil(minX - 0.5f) + 0.5f; x <= maxX; x += 1)
        if (t.e0[0] * x + t.e0[1] * y + t.e0[2] >= 0 && t.e1[0] * x + t.e1[1] * y + t.e1[2] >= 0 &&
            t.e2[0] * x + t.e2[1] * y + t.e2[2] >= 0)
          return true;
    return false;
  }

  static inline uint32_t sample(const Texture& tex, int level, float u, float v) {
    const int w = tex.width[level], h = tex.height[level];
    if (tex.wrap) {
      u -= std::floor(u);
      v -= std::floor(v);
    }
    float fx = u * w - 0.5f, fy = v * h - 0.5f;
    int x0 = int(std::floor(fx)), y0 = int(std::floor(fy));
    uint32_t ax = uint32_t((fx - x0) * 256), ay = uint32_t((fy - y0) * 256);
    int x1, y1;
    if (tex.wrap && !((w & (w - 1)) | (h & (h - 1)))) {
      x0 &= w - 1;
      y0 &= h - 1;
      x1 = (x0 + 1) & (w - 1);
      y1 = (y0 + 1) & (h - 1);
    } else if (tex.wrap) {
      x0 = (x0 + w) % w;
      y0 = (y0 + h) % h;
      x1 = (x0 + 1) % w;
      y1 = (y0 + 1) % h;
    } else {
      x1 = std::min(std::max(x0 + 1, 0), w - 1);
      y1 = std::min(std::max(y0 + 1, 0), h - 1);
      x0 = std::min(std::max(x0, 0), w - 1);
      y0 = std::min(std::max(y0, 0), h - 1);
    }
    const uint32_t* d = tex.data[level].data();
    typedef uint8_t u8x8 __attribute__((vector_size(8)));
    typedef uint16_t u16x8 __attribute__((vector_size(16)));
    typedef uint16_t u16x4 __attribute__((vector_size(8)));
    typedef uint8_t u8x4 __attribute__((vector_size(4)));
    uint32_t left[2] = {d[size_t(y0) * w + x0], d[size_t(y1) * w + x0]};
    uint32_t right[2] = {d[size_t(y0) * w + x1], d[size_t(y1) * w + x1]};
    u8x8 l8, r8;
    std::memcpy(&l8, left, 8);
    std::memcpy(&r8, right, 8);
    const u16x8 l = __builtin_convertvector(l8, u16x8), r = __builtin_convertvector(r8, u16x8);
    const u16x8 across = (l * uint16_t(256 - ax) + r * uint16_t(ax)) >> 8;
    const u16x4 top = __builtin_shufflevector(across, across, 0, 1, 2, 3);
    const u16x4 bottom = __builtin_shufflevector(across, across, 4, 5, 6, 7);
    const u16x4 mixed = (top * uint16_t(256 - ay) + bottom * uint16_t(ay)) >> 8;
    const u8x4 out = __builtin_convertvector(mixed, u8x4);
    uint32_t result;
    std::memcpy(&result, &out, 4);
    return result;
  }

  static inline uint32_t sampleFour(const Texture& tex, int level, float u, float v, const float* tap) {
    const uint32_t a = sample(tex, level, u + tap[0] + tap[2], v + tap[1] + tap[3]);
    const uint32_t b = sample(tex, level, u + tap[0] - tap[2], v + tap[1] - tap[3]);
    const uint32_t c = sample(tex, level, u - tap[0] + tap[2], v - tap[1] + tap[3]);
    const uint32_t d = sample(tex, level, u - tap[0] - tap[2], v - tap[1] - tap[3]);
    const uint32_t even = (((a & 0x00ff00ffu) + (b & 0x00ff00ffu) + (c & 0x00ff00ffu) + (d & 0x00ff00ffu)) >> 2) & 0x00ff00ffu;
    const uint32_t odd =
        ((((a >> 8) & 0x00ff00ffu) + ((b >> 8) & 0x00ff00ffu) + ((c >> 8) & 0x00ff00ffu) + ((d >> 8) & 0x00ff00ffu)) >> 2) &
        0x00ff00ffu;
    return even | (odd << 8);
  }

  static inline uint32_t sampleNearest(const Texture& tex, int level, float u, float v) {
    const int w = tex.width[level], h = tex.height[level];
    if (tex.wrap) {
      u -= std::floor(u);
      v -= std::floor(v);
    }
    const int x = std::clamp(int(u * w), 0, w - 1), y = std::clamp(int(v * h), 0, h - 1);
    return tex.data[level][size_t(y) * w + x];
  }

  static inline float fastLog2(float x) {
    uint32_t bits;
    std::memcpy(&bits, &x, 4);
    return float(int(bits >> 23) - 127) + float(bits & 0x7fffff) * (1.0f / 8388608.0f);
  }

  static bool span(const Triangle& t, float fy, int bx0, int bx1, int& sx0, int& sx1) {
    float lo = float(bx0), hi = float(bx1);
    const float* edges[3] = {t.e0, t.e1, t.e2};
    for (const float* e : edges) {
      const float base = e[1] * fy + e[2];
      if (e[0] > 1e-12f)
        lo = std::max(lo, -base / e[0] - 0.5f);
      else if (e[0] < -1e-12f)
        hi = std::min(hi, -base / e[0] - 0.5f);
      else if (base < 0)
        return false;
    }
    if (lo > hi + 1) return false;
    sx0 = std::max(bx0, int(std::floor(lo)));
    sx1 = std::min(bx1, int(std::ceil(hi)));
    return sx0 <= sx1;
  }

  template <bool Textured>
  void spanTriangle(const Triangle& t, const Shade* shade, int x0, int y0, int x1, int y1, long& tested,
                    long& shaded, long& rows) {
    typedef float f4 __attribute__((vector_size(16)));
    typedef int32_t i4 __attribute__((vector_size(16)));
    const int bx0 = std::max(x0, t.minX), bx1 = std::min(x1, t.maxX);
    const int by0 = std::max(y0, t.minY), by1 = std::min(y1, t.maxY);
    const f4 lane = {0.0f, 1.0f, 2.0f, 3.0f};
    const i4 opaque = {int32_t(0xff000000u), int32_t(0xff000000u), int32_t(0xff000000u), int32_t(0xff000000u)};
    for (int y = by0; y <= by1; y++) {
      const float fy = y + 0.5f;
      int sx0, sx1;
      if (!span(t, fy, bx0, bx1, sx0, sx1)) continue;
      const float fx = sx0 + 0.5f;
      const float w0 = t.e0[0] * fx + t.e0[1] * fy + t.e0[2];
      const float w1 = t.e1[0] * fx + t.e1[1] * fy + t.e1[2];
      const float w2 = t.e2[0] * fx + t.e2[1] * fy + t.e2[2];
      const float q0 = t.q[0] * fx + t.q[1] * fy + t.q[2];
      lanes row = {0, 0, 0, 0};
      if constexpr (!Textured) row = shade->light0 + shade->lightX * fx + shade->lightY * fy;
      const float u0 = t.u[0] * fx + t.u[1] * fy + t.u[2];
      const float v0 = t.v[0] * fx + t.v[1] * fy + t.v[2];
      float* depthRow = &depth[size_t(y) * width];
      uint32_t* colourRow = &colour[size_t(y) * width];
      const float limit = float(sx1 - sx0);
      int level = 0;
      int levelAt = -1000;
      rows++;
      for (int x = sx0; x <= sx1; x += 4) {
        tested += 4;
        const f4 xs = lane + float(x - sx0);
        const f4 a = w0 + t.e0[0] * xs;
        const f4 b = w1 + t.e1[0] * xs;
        const f4 c = w2 + t.e2[0] * xs;
        const f4 qs = q0 + t.q[0] * xs;
        const f4 old = depthGroup(depthRow, x, x1);
        const f4 held = qs * t.bias;
        const i4 mask = (a >= 0.0f) & (b >= 0.0f) & (c >= 0.0f) & (held > old) & (xs <= limit);
        if (!(mask[0] | mask[1] | mask[2] | mask[3])) continue;
        i4 packed;
        if constexpr (Textured) {
          const Texture& tex = *t.texture;
          const f4 iq = 1.0f / qs;
          const f4 us = (u0 + t.u[0] * xs) * iq, vs = (v0 + t.v[0] * xs) * iq;
          if (x - levelAt >= 8) {
            levelAt = x;
            level = mipLevel(t, tex, us[0], vs[0], iq[0]);
          }
          for (int l = 0; l < 4; l++)
            packed[l] = !mask[l]         ? 0
                        : tex.nearest ? int32_t(sampleNearest(tex, level, us[l], vs[l]))
                                      : int32_t(sample(tex, level, us[l], vs[l]));
          packed |= opaque;
        } else if (t.uniform) {
          packed = i4{int32_t(t.flat), int32_t(t.flat), int32_t(t.flat), int32_t(t.flat)};
        } else {
          f4 r = row[0] + shade->lightX[0] * xs, g = row[1] + shade->lightX[1] * xs,
             bl = row[2] + shade->lightX[2] * xs;
          r = r < 0.0f ? 0.0f : r > 255.0f ? 255.0f : r;
          g = g < 0.0f ? 0.0f : g > 255.0f ? 255.0f : g;
          bl = bl < 0.0f ? 0.0f : bl > 255.0f ? 255.0f : bl;
          packed = __builtin_convertvector(r + 0.5f, i4) | (__builtin_convertvector(g + 0.5f, i4) << 8) |
                   (__builtin_convertvector(bl + 0.5f, i4) << 16) | opaque;
        }
        shaded -= mask[0] + mask[1] + mask[2] + mask[3];
        if (x + 3 <= x1 && (mask[0] & mask[1] & mask[2] & mask[3])) {
          std::memcpy(colourRow + x, &packed, sizeof packed);
          std::memcpy(depthRow + x, &held, sizeof held);
          continue;
        }
        if (x + 3 <= x1) {
          i4 before, oldBits, newBits;
          std::memcpy(&before, colourRow + x, sizeof before);
          const i4 after = (packed & mask) | (before & ~mask);
          std::memcpy(colourRow + x, &after, sizeof after);
          std::memcpy(&oldBits, &old, sizeof oldBits);
          std::memcpy(&newBits, &held, sizeof newBits);
          const i4 kept = (newBits & mask) | (oldBits & ~mask);
          std::memcpy(depthRow + x, &kept, sizeof kept);
          continue;
        }
        for (int l = 0; l < 4; l++) {
          if (!mask[l]) continue;
          colourRow[x + l] = uint32_t(packed[l]);
          depthRow[x + l] = held[l];
        }
      }
    }
  }

  static lanes depthGroup(const float* row, int x, int x1) {
    lanes old;
    if (x + 3 <= x1) {
      std::memcpy(&old, row + x, sizeof old);
      return old;
    }
    for (int l = 0; l < 4; l++) old[l] = x + l <= x1 ? row[x + l] : std::numeric_limits<float>::infinity();
    return old;
  }

  static int mipLevel(const Triangle& t, const Texture& tex, float u, float v, float iq) {
    const float texW = float(tex.width[0]), texH = float(tex.height[0]);
    const float dux = (t.u[0] - u * t.q[0]) * iq * texW, dvx = (t.v[0] - v * t.q[0]) * iq * texH;
    const float duy = (t.u[1] - u * t.q[1]) * iq * texW, dvy = (t.v[1] - v * t.q[1]) * iq * texH;
    const float lx = dux * dux + dvx * dvx, ly = duy * duy + dvy * dvy;
    const float major = 0.5f * fastLog2(std::max(std::max(lx, ly), 1e-8f));
    const float minor = 0.5f * fastLog2(std::max(std::min(lx, ly), 1e-8f));
    const float lod = std::max(major - anisotropyLevels, 0.5f * (major + minor)) - (tex.sharp ? sharpBias : 0.0f);
    return std::min(tex.levels - 1, std::max(0, int(lod + 0.5f)));
  }

  static bool plainTexture(const Triangle& t) {
    const Texture& tex = *t.texture;
    return !tex.cutout && !tex.shadow && !tex.blend && !t.tinted;
  }

  void rasterTriangle(const Triangle& t, int x0, int y0, int x1, int y1, long& tested, long& shaded, long& rows) {
    const Texture& tex = *t.texture;
    const int bx0 = std::max(x0, t.minX), bx1 = std::min(x1, t.maxX);
    const int by0 = std::max(y0, t.minY), by1 = std::min(y1, t.maxY);
    const float texW = float(tex.width[0]), texH = float(tex.height[0]);
    const int topLevel = tex.levels - 1;
    typedef float f4 __attribute__((vector_size(16)));
    typedef int32_t i4 __attribute__((vector_size(16)));
    const f4 lane = {0.0f, 1.0f, 2.0f, 3.0f};
    for (int y = by0; y <= by1; y++) {
      const float fy = y + 0.5f;
      int sx0, sx1;
      if (!span(t, fy, bx0, bx1, sx0, sx1)) continue;
      const float fx = bx0 + 0.5f;
      const float w0 = t.e0[0] * fx + t.e0[1] * fy + t.e0[2];
      const float w1 = t.e1[0] * fx + t.e1[1] * fy + t.e1[2];
      const float w2 = t.e2[0] * fx + t.e2[1] * fy + t.e2[2];
      const float q0 = t.q[0] * fx + t.q[1] * fy + t.q[2];
      const float u0 = t.u[0] * fx + t.u[1] * fy + t.u[2];
      const float v0 = t.v[0] * fx + t.v[1] * fy + t.v[2];
      float* depthRow = &depth[size_t(y) * width];
      uint32_t* colourRow = &colour[size_t(y) * width];
      int level = -1;
      int levelAt = -1000;
      float tap[4] = {0, 0, 0, 0};
      const float limit = float(sx1 - bx0);
      rows++;
      for (int x = sx0; x <= sx1; x += 4) {
        tested += 4;
        const float off = float(x - bx0);
        const f4 xs = lane + off;
        const f4 a = w0 + t.e0[0] * xs;
        const f4 b = w1 + t.e1[0] * xs;
        const f4 c = w2 + t.e2[0] * xs;
        const f4 qs = q0 + t.q[0] * xs;
        const f4 old = depthGroup(depthRow, x, x1);
        const i4 mask = (a >= 0.0f) & (b >= 0.0f) & (c >= 0.0f) & (qs * t.bias > old) & (xs <= limit);
        if (!(mask[0] | mask[1] | mask[2] | mask[3])) continue;
        for (int l = 0; l < 4; l++) {
          if (!mask[l]) continue;
          const int px = x + l;
          const float o = off + l;
          const float q = qs[l];
          const float iq = 1.0f / q;
          const float u = (u0 + t.u[0] * o) * iq, v = (v0 + t.v[0] * o) * iq;
          if (px - levelAt >= 8) {
            levelAt = px;
            const float dux = (t.u[0] - u * t.q[0]) * iq * texW, dvx = (t.v[0] - v * t.q[0]) * iq * texH;
            const float duy = (t.u[1] - u * t.q[1]) * iq * texW, dvy = (t.v[1] - v * t.q[1]) * iq * texH;
            const float lx = dux * dux + dvx * dvx, ly = duy * duy + dvy * dvy;
            const float major = 0.5f * fastLog2(std::max(std::max(lx, ly), 1e-8f));
            const float minor = 0.5f * fastLog2(std::max(std::min(lx, ly), 1e-8f));
            const float lod = std::max(major - anisotropyLevels, 0.5f * (major + minor));
            level = std::min(topLevel, std::max(0, int(lod + 0.5f - (tex.sharp ? 1.0f : 0.0f))));
            if (tex.sharp) {
              tap[0] = 0.25f * dux / texW;
              tap[1] = 0.25f * dvx / texH;
              tap[2] = 0.25f * duy / texW;
              tap[3] = 0.25f * dvy / texH;
            }
          }
          uint32_t cl = tex.nearest ? sampleNearest(tex, level, u, v)
                        : tex.sharp ? sampleFour(tex, level, u, v, tap)
                                    : sample(tex, level, u, v);
          if (tex.shadow) {
            const uint32_t keep = 256 - (cl >> 24);
            const uint32_t under = colourRow[px];
            const uint32_t rb = (((under & 0x00ff00ffu) * keep) >> 8) & 0x00ff00ffu;
            const uint32_t g = (((under & 0x0000ff00u) * keep) >> 8) & 0x0000ff00u;
            colourRow[px] = rb | g | 0xff000000u;
            shaded++;
            continue;
          }
          if (tex.cutout && (cl >> 24) < 128) continue;
          const uint32_t cover = cl >> 24;
          if (t.tinted) {
            uint32_t r = std::min(255u, ((cl & 255) * (t.tintPacked & 1023)) >> 6);
            uint32_t g = std::min(255u, (((cl >> 8) & 255) * ((t.tintPacked >> 10) & 1023)) >> 6);
            uint32_t bl = std::min(255u, (((cl >> 16) & 255) * ((t.tintPacked >> 20) & 1023)) >> 6);
            cl = r | (g << 8) | (bl << 16);
          }
          if (tex.blend) {
            const uint32_t under = colourRow[px], keep = 256 - cover, take = cover;
            const uint32_t rb = ((((under & 0x00ff00ffu) * keep) + ((cl & 0x00ff00ffu) * take)) >> 8) & 0x00ff00ffu;
            const uint32_t g = ((((under & 0x0000ff00u) * keep) + ((cl & 0x0000ff00u) * take)) >> 8) & 0x0000ff00u;
            colourRow[px] = rb | g | 0xff000000u;
            shaded++;
            continue;
          }
          colourRow[px] = cl | 0xff000000u;
          depthRow[px] = q * t.bias;
          shaded++;
        }
      }
    }
  }

  void rasterTile(int index) {
    const int tx = index % tilesX, ty = index / tilesX;
    const int x0 = tx * tile, y0 = ty * tile;
    const int x1 = std::min(width, x0 + tile) - 1, y1 = std::min(height, y0 + tile) - 1;
    for (int y = y0; y <= y1; y++) std::fill(&depth[size_t(y) * width + x0], &depth[size_t(y) * width + x1] + 1, 0.0f);
    long tested = 0, shaded = 0, rows = 0;
    for (uint32_t r = tileCounts[size_t(index)]; r < tileCounts[size_t(index) + 1]; r++) {
      const ClusterOutput& out = outputs[tileRefs[r].item];
      const Triangle& t = out.tris[tileRefs[r].triangle];
      if (t.mode == 2)
        spanTriangle<false>(t, &out.shades[size_t(t.lit)], x0, y0, x1, y1, tested, shaded, rows);
      else if (plainTexture(t))
        spanTriangle<true>(t, nullptr, x0, y0, x1, y1, tested, shaded, rows);
      else
        rasterTriangle(t, x0, y0, x1, y1, tested, shaded, rows);
    }
    stats.tested += tested;
    stats.shaded += shaded;
    stats.rows += rows;
    for (int y = y0; y <= y1; y += 2)
      for (int x = x0; x <= x1; x += skyBlock) {
        uint32_t shared = 0;
        bool computed = false;
        for (int oy = 0; oy < 2 && y + oy <= y1; oy++)
          for (int ox = 0; ox < skyBlock && x + ox <= x1; ox++) {
            size_t at = size_t(y + oy) * width + x + ox;
            if (depth[at] != 0) continue;
            if (!computed) {
              float d[3];
              for (int c = 0; c < 3; c++) d[c] = corner[c] + right[c] * (x + skyBlock * 0.5f) + down[c] * (y + 1.0f);
              shared = groundUnder(skyColour(d), d);
              computed = true;
            }
            colour[at] = shared;
          }
      }
  }

  uint32_t groundUnder(uint32_t sky, const float* d) const {
    if (!ground.on) return sky;
    const float length = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const float below = length > 0 ? -d[1] / length : 0;
    if (below <= ground.from) return sky;
    float t = std::min(1.0f, (below - ground.from) / ground.fade);
    t = t * t * (3 - 2 * t);
    uint32_t out = 0xff000000u;
    for (int c = 0; c < 3; c++) {
      const float s = float((sky >> (c * 8)) & 255);
      out |= uint32_t(s + (ground.colour[c] - s) * t + 0.5f) << (c * 8);
    }
    return out;
  }

  uint32_t skyColour(const float* d) const {
    const float length = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const float up = length > 0 ? d[1] / length : 0;
    const float t = std::sqrt(std::clamp(up / skySpan, 0.0f, 1.0f));
    uint32_t out = 0xff000000u;
    for (int c = 0; c < 3; c++)
      out |= uint32_t(sky.horizon[c] + (sky.zenith[c] - sky.horizon[c]) * t + 0.5f) << (c * 8);
    return out;
  }

  Pool pool;
  int width = 0, height = 0, tilesX = 0, tilesY = 0;
  std::vector<uint32_t> colour;
  std::vector<float> depth;
  std::vector<Draw> draws;
  std::vector<WorkItem> work;
  std::vector<ClusterOutput> outputs;
  std::vector<uint32_t> tileCounts;
  std::vector<TileRef> tileRefs;
  std::vector<double> tileCost;
  std::vector<uint32_t> tileOrder;

  Lighting lighting;

 public:
  struct Ground {
    bool on = false;
    float colour[3] = {0, 0, 0};
    float from = 0;
    float fade = 0.05f;
  } ground;
  Sky sky;

 private:
  float vp[16] = {0};
  float corner[3] = {0}, right[3] = {0}, down[3] = {0};
  static constexpr float nearW = 0.25f;
  static constexpr float anisotropyLevels = 2.0f;
  static constexpr float skySpan = 0.5f;
};

}
