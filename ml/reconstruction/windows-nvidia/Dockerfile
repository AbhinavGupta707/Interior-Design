# syntax=docker/dockerfile:1.7
FROM docker.io/library/python:3.10.13-slim-bullseye@sha256:b1c82dbf6dfb5e52cf8f595c9b6881696e4a5e996e5146cb99e19c2228592b6a AS python-runtime

FROM docker.io/nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04@sha256:bd746eb3b9953805ebe644847a227e218b5da775f47007c69930569a75c9ad7d AS colmap-builder

ARG COLMAP_COMMIT=e99036415ec0cf0f75c1d0b8d60fdd91af0d6c68
ARG CUDA_ARCHITECTURES=75;80;86;89

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      git \
      libboost-filesystem-dev \
      libboost-graph-dev \
      libboost-program-options-dev \
      libboost-system-dev \
      libcgal-dev \
      libceres-dev \
      libeigen3-dev \
      libflann-dev \
      libfreeimage-dev \
      libglew-dev \
      libgoogle-glog-dev \
      libmetis-dev \
      libqt5opengl5-dev \
      libsqlite3-dev \
      ninja-build \
      qtbase5-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --filter=blob:none --no-checkout https://github.com/colmap/colmap.git /src/colmap \
    && git -C /src/colmap checkout --detach "${COLMAP_COMMIT}" \
    && cmake -S /src/colmap -B /src/colmap/build -GNinja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCHITECTURES}" \
      -DCMAKE_INSTALL_PREFIX=/opt/colmap \
    && cmake --build /src/colmap/build --parallel 1 \
    && cmake --install /src/colmap/build

FROM docker.io/nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04@sha256:bd746eb3b9953805ebe644847a227e218b5da775f47007c69930569a75c9ad7d AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/local/bin:/opt/colmap/bin:/usr/bin:/bin \
    PYTHONHASHSEED=0 \
    PYTHONNOUSERSITE=1 \
    PYTHONPATH=/opt/c8/inference-worker/src \
    PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      ffmpeg \
      libboost-filesystem1.74.0 \
      libboost-program-options1.74.0 \
      libc6 \
      libceres2 \
      libfreeimage3 \
      libgcc-s1 \
      libgl1 \
      libglew2.2 \
      libgoogle-glog0v5 \
      libqt5core5a \
      libqt5gui5 \
      libqt5widgets5 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=python-runtime /usr/local /usr/local
COPY --from=colmap-builder /opt/colmap /opt/colmap
COPY ml/reconstruction/windows-nvidia/requirements.lock /opt/c8/requirements.lock
RUN python -m pip install \
      --disable-pip-version-check \
      --extra-index-url https://download.pytorch.org/whl/cu118 \
      --no-cache-dir \
      --require-hashes \
      --requirement /opt/c8/requirements.lock \
    && python -m pip check

COPY services/inference-worker/src /opt/c8/inference-worker/src
COPY ml/reconstruction/windows-nvidia/run_fixed_adapter.py /opt/c8/run_fixed_adapter.py
RUN groupadd --gid 65532 c8 \
    && useradd --no-create-home --no-log-init --uid 65532 --gid 65532 c8 \
    && mkdir --parents /c8/input /c8/output /c8/work \
    && chown --recursive 65532:65532 /c8

USER 65532:65532
WORKDIR /c8/work
ENTRYPOINT ["python", "/opt/c8/run_fixed_adapter.py"]
