dist/mp4info.wasm.js:
	mkdir -p dist && \
	emcc --bind \
	-O3 \
	-L/opt/ffmpeg/lib \
	-I/opt/ffmpeg/include/ \
	-s 'EXPORT_NAME="Module"' \
	-s EXTRA_EXPORTED_RUNTIME_METHODS="[FS, cwrap, ccall, getValue, setValue, writeAsciiToMemory, addFunction, WORKERFS]" \
	-s INITIAL_MEMORY=268435456 \
	-s ASSERTIONS=1 \
	-s STACK_OVERFLOW_CHECK=2 \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s FORCE_FILESYSTEM=1 \
	-s ALLOW_TABLE_GROWTH=1 \
	-lavcodec -lavformat -lavfilter -lavdevice -lswresample -lpostproc -lswscale -lavutil -lm -lworkerfs.js \
	-o dist/mp4info.html \
	-g \
	-fdebug-compilation-dir='dist' \
	mp4info-wrapper.cpp