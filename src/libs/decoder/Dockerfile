FROM emscripten/emsdk:2.0.34 as build

ARG FFMPEG_VERSION=5.1.3
ARG X264_VERSION=20170226-2245-stable
ARG X265_VERSION=x265-2.7
ARG x265_DIR_NAME=multicoreware-x265-e41a9bf2bac4

ARG PREFIX=/opt/ffmpeg
ARG MAKEFLAGS="-j4"

RUN apt-get update && apt-get install -y autoconf libtool build-essential

# libx264
# RUN cd /tmp && \
#   wget https://download.videolan.org/pub/videolan/x264/snapshots/x264-snapshot-${X264_VERSION}.tar.bz2 && \
#   tar xvfj x264-snapshot-${X264_VERSION}.tar.bz2

# RUN cd /tmp/x264-snapshot-${X264_VERSION} && \
#   emconfigure ./configure \
#   --prefix=${PREFIX} \
#   --host=i686-gnu \
#   --enable-static \
#   --disable-cli \
#   --disable-asm \
#   --extra-cflags="-s USE_PTHREADS=1"

# RUN cd /tmp/x264-snapshot-${X264_VERSION} && \
#   emmake make && emmake make install 

# libx265
# RUN cd /tmp && \
#   wget http://ftp.videolan.org/pub/videolan/x265/${X265_VERSION}.tar.bz2 && \
#   tar xvfj ${X265_VERSION}.tar.bz2 && \
#   ls

# RUN cd /tmp/${x265_DIR_NAME} && \
#   emconfigure ./configure \
#   --prefix=${PREFIX} \
#   --disable-asm \
#   --disable-thread \
#   --disable-pthread \
#   --disable-shared \
#   --enable-static \
#   --extra-cflags="-s USE_PTHREADS=1"

# RUN cd /tmp/${x265_DIR_NAME} && \
#   emmake make && emmake make install 

# Get ffmpeg source.

WORKDIR /build

RUN cd /tmp/ && \
  wget http://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.gz && \
  tar zxf ffmpeg-${FFMPEG_VERSION}.tar.gz && rm ffmpeg-${FFMPEG_VERSION}.tar.gz

ARG CFLAGS="-s USE_PTHREADS=1 -O3 -I${PREFIX}/include"
ARG LDFLAGS="$CFLAGS -L${PREFIX}/lib -s INITIAL_MEMORY=33554432"

# Compile ffmpeg.
# https://github.com/FFmpeg/FFmpeg/blob/master/configure
RUN cd /tmp/ffmpeg-${FFMPEG_VERSION} && \
  emconfigure ./configure \
  --prefix=${PREFIX} \
  --target-os=none \
  --arch=x86_32 \
  --enable-cross-compile \
  --disable-debug \
  --disable-x86asm \
  --disable-inline-asm \
  --disable-stripping \
  --disable-programs \
  --disable-doc \
  --disable-all \
  --enable-avcodec \
  --enable-avformat \
  --enable-avfilter \
  --enable-avdevice \
  --enable-avutil \
  --enable-swresample \
  --enable-postproc \
  --enable-swscale \
  --enable-filters \
  --enable-protocol=file \
  --enable-decoder=hevc,h264,aac,pcm_s16le \
  --enable-demuxer=mov,matroska \
  --enable-muxer=mp4 \
  --enable-gpl \
  # --enable-libx265 \
  # --enable-libx264 \
  --extra-cflags="$CFLAGS" \
  --extra-cxxflags="$CFLAGS" \
  --extra-ldflags="$LDFLAGS" \
  --nm="llvm-nm -g" \
  --ar=emar \
  --as=llvm-as \
  --ranlib=llvm-ranlib \
  --cc=emcc \
  --cxx=em++ \
  --objcc=emcc \
  --dep-cc=emcc

RUN cd /tmp/ffmpeg-${FFMPEG_VERSION} && \
  emmake make -j4 && \
  emmake make install


COPY ./mp4info-wrapper.cpp /build/src/mp4info-wrapper.cpp
COPY ./Makefile /build/Makefile

WORKDIR /build

# RUN make