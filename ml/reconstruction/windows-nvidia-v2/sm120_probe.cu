#include <cuda_runtime.h>

#include <cstdio>

__global__ void c8_sm120_kernel(int* output) { *output = 120; }

int main() {
  cudaDeviceProp properties{};
  if (cudaGetDeviceProperties(&properties, 0) != cudaSuccess ||
      properties.major != 12 || properties.minor != 0) {
    return 2;
  }
  int* output = nullptr;
  if (cudaMallocManaged(&output, sizeof(int)) != cudaSuccess) {
    return 3;
  }
  c8_sm120_kernel<<<1, 1>>>(output);
  const cudaError_t result = cudaDeviceSynchronize();
  if (result != cudaSuccess || *output != 120) {
    cudaFree(output);
    return 4;
  }
  std::printf(
      "{\"compiledArchitecture\":\"sm_120\",\"computeCapability\":\"%d.%d\","
      "\"deviceName\":\"%s\",\"kernelResult\":%d}\n",
      properties.major, properties.minor, properties.name, *output);
  cudaFree(output);
  return 0;
}
