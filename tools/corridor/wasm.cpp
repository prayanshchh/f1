#include <emscripten.h>
#include <emscripten/threading.h>

#include <atomic>
#include <climits>
#include <condition_variable>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <type_traits>
#include <vector>

#include "raster.h"

using namespace corridor;

namespace {
struct OwnedMesh {
  std::vector<float> positions, normals, uvs;
  std::vector<uint32_t> colours, indices;
  Mesh mesh;
};

struct Item {
  const Mesh* mesh;
  int matrix;
};

struct Frame {
  float camera[25];
  Lighting light;
  std::vector<Item> items;
  std::vector<float> matrices;
};

std::unique_ptr<Renderer> renderer;
std::vector<std::unique_ptr<Texture>> textures;
std::vector<std::unique_ptr<OwnedMesh>> meshes;
std::vector<int> freeMeshes, freeTextures, doomedMeshes, doomedTextures;

Frame pending;
std::mutex renderMutex;
std::condition_variable renderWake;
std::atomic<int> busy{0};
bool renderQueued = false;
double frameMs = 0;
double lastRasterMs = 0, lastTransformMs = 0;
int lastTriangles = 0, lastShaded = 0;

struct Shown {
  std::atomic<int32_t> frame{0};
  int32_t width = 0;
  int32_t height = 0;
  int32_t pixels = 0;
  std::atomic<int32_t> reading{0};
  std::atomic<int32_t> seen{0};
  float presentMs = 0;
  int32_t spare = 0;
};
Shown shown;
std::vector<uint32_t> front;

struct Build {
  Texture* texture;
  uint32_t* pixels;
  int width, height;
};
std::mutex loadMutex;
std::condition_variable loadWake;
std::deque<Build> builds;

double clock() { return emscripten_get_now(); }

void publish() {
  int32_t idle = 0;
  while (!shown.reading.compare_exchange_weak(idle, 2, std::memory_order_acquire)) {
    idle = 0;
    std::this_thread::yield();
  }
  renderer->hand(front);
  shown.width = renderer->frameWidth();
  shown.height = renderer->frameHeight();
  shown.pixels = int32_t(reinterpret_cast<uintptr_t>(front.data()));
  shown.reading.store(0, std::memory_order_release);
  shown.frame.fetch_add(1, std::memory_order_release);
  emscripten_futex_wake(&shown.frame, INT_MAX);
}

void renderLoop() {
  for (;;) {
    {
      std::unique_lock<std::mutex> lock(renderMutex);
      renderWake.wait(lock, [] { return renderQueued; });
      renderQueued = false;
    }
    const double started = clock();
    const float* c = pending.camera;
    renderer->begin(c, c + 16, c + 19, c + 22, &pending.light);
    for (const Item& item : pending.items)
      renderer->draw(*item.mesh, item.matrix < 0 ? nullptr : &pending.matrices[size_t(item.matrix) * 16]);
    renderer->finish();
    publish();
    frameMs = clock() - started;
    lastRasterMs = renderer->stats.rasterMs;
    lastTransformMs = renderer->stats.transformMs;
    lastTriangles = renderer->stats.triangles;
    lastShaded = int(renderer->stats.shaded.load());
    busy.store(0, std::memory_order_release);
  }
}

void loadLoop() {
  for (;;) {
    Build build;
    {
      std::unique_lock<std::mutex> lock(loadMutex);
      loadWake.wait(lock, [] { return !builds.empty(); });
      build = builds.front();
      builds.pop_front();
    }
    build.texture->build(build.pixels, build.width, build.height);
    free(build.pixels);
    build.texture->ready.store(true, std::memory_order_release);
  }
}

int store(std::unique_ptr<Texture> texture) {
  if (!freeTextures.empty()) {
    int id = freeTextures.back();
    freeTextures.pop_back();
    textures[size_t(id)] = std::move(texture);
    return id;
  }
  textures.push_back(std::move(texture));
  return int(textures.size()) - 1;
}

void reorder(OwnedMesh& m, int vertexCount) {
  std::vector<int> first(size_t(vertexCount), -1);
  int next = 0;
  for (uint32_t& index : m.indices) {
    if (first[index] < 0) first[index] = next++;
    index = uint32_t(first[index]);
  }
  auto remap = [&](auto& values, int width) {
    if (values.empty()) return;
    std::remove_reference_t<decltype(values)> out(size_t(next) * width);
    for (int v = 0; v < vertexCount; v++)
      if (first[size_t(v)] >= 0)
        std::memcpy(&out[size_t(first[size_t(v)]) * width], &values[size_t(v) * width],
                    sizeof(values[0]) * width);
    values.swap(out);
  };
  remap(m.positions, 3);
  remap(m.normals, 3);
  remap(m.uvs, 2);
  remap(m.colours, 1);
  m.mesh.vertexCount = next;
}

void reap() {
  for (int id : doomedMeshes) {
    meshes[size_t(id)].reset();
    freeMeshes.push_back(id);
  }
  doomedMeshes.clear();
  std::vector<int> waiting;
  for (int id : doomedTextures) {
    if (!textures[size_t(id)]->ready.load(std::memory_order_acquire)) {
      waiting.push_back(id);
      continue;
    }
    textures[size_t(id)].reset();
    freeTextures.push_back(id);
  }
  doomedTextures.swap(waiting);
}
}

static void configure(Texture& texture, int flags) {
  texture.cutout = (flags & 1) != 0;
  texture.wrap = (flags & 2) != 0;
  texture.shadow = (flags & 4) != 0;
  texture.blend = (flags & 8) != 0;
  texture.sharp = (flags & 16) != 0;
  texture.nearest = (flags & 32) != 0;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void cr_init(int threads) {
  renderer = std::make_unique<Renderer>(threads);
  std::thread(renderLoop).detach();
  std::thread(loadLoop).detach();
}

EMSCRIPTEN_KEEPALIVE void cr_resize(int width, int height) { renderer->resize(width, height); }

EMSCRIPTEN_KEEPALIVE int cr_texture(const uint32_t* pixels, int width, int height, int flags) {
  auto texture = std::make_unique<Texture>();
  configure(*texture, flags);
  texture->build(pixels, width, height);
  return store(std::move(texture));
}

EMSCRIPTEN_KEEPALIVE int cr_texture_async(uint32_t* pixels, int width, int height, int flags) {
  auto texture = std::make_unique<Texture>();
  configure(*texture, flags);
  texture->ready.store(false);
  Texture* raw = texture.get();
  int id = store(std::move(texture));
  {
    std::lock_guard<std::mutex> lock(loadMutex);
    builds.push_back({raw, pixels, width, height});
  }
  loadWake.notify_one();
  return id;
}

EMSCRIPTEN_KEEPALIVE int cr_texture_ready(int texture) {
  return textures[size_t(texture)]->ready.load(std::memory_order_acquire) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int cr_mesh(const float* positions, const float* normals, const float* uvs,
                                 const uint32_t* colours, const uint32_t* indices, int vertexCount, int indexCount,
                                 int texture, float r, float g, float b) {
  auto owned = std::make_unique<OwnedMesh>();
  owned->positions.assign(positions, positions + size_t(vertexCount) * 3);
  if (normals) owned->normals.assign(normals, normals + size_t(vertexCount) * 3);
  if (uvs) owned->uvs.assign(uvs, uvs + size_t(vertexCount) * 2);
  if (colours) owned->colours.assign(colours, colours + vertexCount);
  owned->indices.assign(indices, indices + indexCount);
  reorder(*owned, vertexCount);
  Mesh& m = owned->mesh;
  m.positions = owned->positions.data();
  m.normals = normals ? owned->normals.data() : nullptr;
  m.uvs = uvs ? owned->uvs.data() : nullptr;
  m.colours = colours ? owned->colours.data() : nullptr;
  m.indices = owned->indices.data();
  m.indexCount = indexCount;
  m.texture = texture >= 0 ? textures[size_t(texture)].get() : nullptr;
  m.tint[0] = r;
  m.tint[1] = g;
  m.tint[2] = b;
  m.bound();
  if (!freeMeshes.empty()) {
    int id = freeMeshes.back();
    freeMeshes.pop_back();
    meshes[size_t(id)] = std::move(owned);
    return id;
  }
  meshes.push_back(std::move(owned));
  return int(meshes.size()) - 1;
}

EMSCRIPTEN_KEEPALIVE void cr_mesh_cull(int mesh, int cull) { meshes[size_t(mesh)]->mesh.cull = cull != 0; }

EMSCRIPTEN_KEEPALIVE void cr_mesh_texture(int mesh, int texture) {
  meshes[size_t(mesh)]->mesh.texture = textures[size_t(texture)].get();
}

EMSCRIPTEN_KEEPALIVE void cr_mesh_bias(int mesh, float bias) { meshes[size_t(mesh)]->mesh.bias = bias; }

EMSCRIPTEN_KEEPALIVE void cr_ground(float r, float g, float b, float from, float fade) {
  renderer->ground = {true, {r, g, b}, from, fade};
}

EMSCRIPTEN_KEEPALIVE void cr_release_mesh(int mesh) { doomedMeshes.push_back(mesh); }

EMSCRIPTEN_KEEPALIVE void cr_release_texture(int texture) { doomedTextures.push_back(texture); }

EMSCRIPTEN_KEEPALIVE void cr_sky(float zr, float zg, float zb, float hr, float hg, float hb) {
  renderer->sky = {{zr, zg, zb}, {hr, hg, hb}};
}

EMSCRIPTEN_KEEPALIVE int cr_busy() { return busy.load(std::memory_order_acquire); }

EMSCRIPTEN_KEEPALIVE int cr_submit(const float* camera, const int* list, int count, const float* matrices,
                                   int matrixCount, const float* light) {
  if (busy.load(std::memory_order_acquire)) return 0;
  reap();
  std::memcpy(pending.camera, camera, sizeof pending.camera);
  if (light) {
    std::memcpy(pending.light.sun, light, sizeof(float) * 3);
    std::memcpy(pending.light.sunColour, light + 3, sizeof(float) * 3);
    std::memcpy(pending.light.skyColour, light + 6, sizeof(float) * 3);
    std::memcpy(pending.light.groundColour, light + 9, sizeof(float) * 3);
  }
  pending.items.clear();
  for (int i = 0; i < count; i++) {
    const OwnedMesh* owned = meshes[size_t(list[i * 2])].get();
    if (owned) pending.items.push_back({&owned->mesh, list[i * 2 + 1]});
  }
  pending.matrices.assign(matrices, matrices + size_t(matrixCount) * 16);
  busy.store(1, std::memory_order_release);
  {
    std::lock_guard<std::mutex> lock(renderMutex);
    renderQueued = true;
  }
  renderWake.notify_one();
  return 1;
}

EMSCRIPTEN_KEEPALIVE double cr_frame(const float* camera, const int* list, int count, const float* matrices,
                                     int matrixCount, const float* light) {
  while (cr_busy()) {
  }
  cr_submit(camera, list, count, matrices, matrixCount, light);
  while (cr_busy()) {
  }
  return frameMs;
}

EMSCRIPTEN_KEEPALIVE const uint32_t* cr_pixels() { return front.data(); }

EMSCRIPTEN_KEEPALIVE Shown* cr_shown() { return &shown; }

EMSCRIPTEN_KEEPALIVE int cr_triangles() { return lastTriangles; }

EMSCRIPTEN_KEEPALIVE int cr_shaded() { return lastShaded; }

EMSCRIPTEN_KEEPALIVE double cr_raster_ms() { return lastRasterMs; }

EMSCRIPTEN_KEEPALIVE double cr_transform_ms() { return lastTransformMs; }

EMSCRIPTEN_KEEPALIVE double cr_frame_ms() { return frameMs; }
}
