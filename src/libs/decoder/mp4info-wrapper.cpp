#include <stdio.h>
#include <iostream>
#include <string>

#ifndef __EMSCRIPTEN__
using namespace std;
#endif


#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/bind.h>
using namespace emscripten;
#endif

extern "C"
{
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libavutil/samplefmt.h>
#include <libavutil/timestamp.h>
#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>
#include <libavutil/avutil.h>
};

typedef struct YUVData {
    uint8_t* data_y;
    uint8_t* data_u;
    uint8_t* data_v;
    int linesize_y;
    int linesize_u;
    int linesize_v;
    int width;
    int height;
    int pts;
    int play_timestamp;
    int frame_number;
    bool last_frame;
} YUVData;

typedef struct JPGData {
    uint8_t* jpg_data;
    int width;
    int height;
    int pts;
    int play_timestamp;
    int frame_number;
} JPGData;

enum DECODE_STATUS
{
    NOT_BEGIN,
    DECODING,
    PAUSE,
    FINISH
};

// Define a callback function type
typedef void (*YUVDataCallback)(YUVData** yuv_arr, int decode_count, bool last_frame);
typedef void (*DecodeStatusCallback)(DECODE_STATUS decode_status);

// Declare the callback function
YUVDataCallback yuvDataCallback = nullptr;
DecodeStatusCallback decodeStatusCallback = nullptr;

#ifdef __EMSCRIPTEN__
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void setYUVDataCallback(YUVDataCallback callback) {
        printf("设置回调函数YUVDataCallback------------------");
        yuvDataCallback = callback;
    }
    EMSCRIPTEN_KEEPALIVE
    void setDecodeStatusCallback(DecodeStatusCallback callback) {
        printf("设置回调函数DecodeStatusCallback------------------");
        decodeStatusCallback = callback;
    }
}
#endif

static AVFormatContext* fmt_ctx;
const char* filename;
static int video_stream_idx = -1, audio_stream_idx = -1;
AVStream* video_st = NULL;
AVStream* audio_st = NULL;
const AVCodec* video_dec;
const AVCodec* audio_dec;
static AVCodecContext* video_dec_ctx, * audio_dec_ctx;
AVRational video_stream_time_base;
AVRational audio_stream_time_base;
AVFrame* decode_frame;
AVPacket* decode_pkt;
YUVData** yuv_arr;
DECODE_STATUS decode_status = NOT_BEGIN;
int* seek_timestamp = 0;

#ifndef __EMSCRIPTEN__
JPGData** jpg_arr;
const AVCodec* jpegCodec = avcodec_find_encoder(AV_CODEC_ID_MJPEG);
AVPacket* jpegPacket = av_packet_alloc();
AVCodecContext* jpegCodecContext = avcodec_alloc_context3(jpegCodec);

static const char* video_dst_dir = "C:/Users/19112/Desktop/video_capture/";
#endif

#ifndef __EMSCRIPTEN__
std::string get_filename(const std::string& url) {
    std::string filename = "";
    size_t lastSlashPos = url.find_last_of('/');
    if (lastSlashPos != std::string::npos && lastSlashPos < url.length() - 1) {
        filename = url.substr(lastSlashPos + 1);
    }
    size_t lastDotPos = filename.find_last_of(".");
    if (lastDotPos != std::string::npos) {
        return filename.substr(0, lastDotPos);
    }
    return filename;
}

std::string parse_output_filename(int frame_number, std::string ext) {
    std::string filename = get_filename(fmt_ctx->url);
    std::string out_filename = filename + "_" + std::to_string(frame_number) + "." + ext;
    return out_filename;
}
int save_jpg_arr(int* count, AVFrame* out_frame, uint8_t* jpg_data) {
    int ret = 0;
    int play_timestamp = av_rescale_q(out_frame->pts, video_stream_time_base, av_make_q(1, 1000));
    JPGData* jpg = new JPGData;
    jpg->jpg_data = new uint8_t[sizeof(jpg_data)];
    memcpy(jpg->jpg_data, jpg_data, sizeof(jpg_data));
    jpg->width = out_frame->width;
    jpg->height = out_frame->height;
    jpg->pts = out_frame->pts;
    jpg->play_timestamp = play_timestamp;
    jpg->frame_number = video_dec_ctx->frame_number;

    jpg_arr[*count] = jpg;

    return ret;
}

int get_jpg_data(AVFrame* frame, AVCodecContext* video_dec_ctx) {
    jpegCodecContext->width = frame->width;
    jpegCodecContext->height = frame->height;
    jpegCodecContext->pix_fmt = AV_PIX_FMT_YUVJ420P;
    jpegCodecContext->time_base = av_inv_q(video_dec_ctx->framerate);
    avcodec_open2(jpegCodecContext, jpegCodec, nullptr);
    av_init_packet(jpegPacket);
    if (avcodec_send_frame(jpegCodecContext, frame) == 0 &&
        avcodec_receive_packet(jpegCodecContext, jpegPacket) == 0) {
        return 0;
    }
    return -1;
}

int output_yuv_jpg(AVFrame* frame, AVCodecContext* video_dec_ctx, int64_t play_timestamp) {
    std::string out_filename = parse_output_filename(play_timestamp, "jpg");
    std::string dst_filename = video_dst_dir + out_filename;
    printf("输出文件名: %s\n", out_filename.c_str());
    FILE* jpegFile = fopen(dst_filename.c_str(), "wb");
    fwrite(jpegPacket->data, 1, jpegPacket->size, jpegFile);
    fclose(jpegFile);
    return 0;
}

int output_jpg_c(AVFrame* frame, AVCodecContext* video_dec_ctx) {
    int ret = 0;
    printf("当前运行环境为C++\n");
    int play_timestamp = av_rescale_q(frame->pts, video_stream_time_base, av_make_q(1, 1000));
    output_yuv_jpg(frame, video_dec_ctx, play_timestamp);
    return ret;
}
#endif

#ifndef __EMSCRIPTEN__
int free_jpg_data(JPGData *jpgData) {
    int ret = 0;
    if (jpgData) {
        if (jpgData->jpg_data) {
            free(jpgData->jpg_data);
            jpgData->jpg_data = NULL;
        }

        free(jpgData);
        return 0;
    }

    return 1;
}

int free_jpg_arr(int arr_count) {
    int ret = 0;
    for (int i = 0; i < arr_count; i++) {
        free_jpg_data(jpg_arr[i]);
    }
    free(jpg_arr);
    return ret;
}
#endif

int free_yuv_data(YUVData* yuvData) {
    int ret = 0;
    if (yuvData) {
        if (yuvData->data_y) {
            free(yuvData->data_y);
            yuvData->data_y = NULL;
        }

        // 释放data_u数组内存
        if (yuvData->data_u) {
            free(yuvData->data_u);
            yuvData->data_u = NULL;
        }

        // 释放data_v数组内存
        if (yuvData->data_v) {
            free(yuvData->data_v);
            yuvData->data_v = NULL;
        }

        free(yuvData);
        return 0;
    }

    return 1;
}

int free_yuv_arr(int arr_count) {
    int ret = 0;
    for (int i = 0; i < arr_count; i++) {
        free_yuv_data(yuv_arr[i]);
    }
    free(yuv_arr);
    return ret;
}

int output_yuv_to_js(int decode_count) {
    int ret = 0;
#ifdef __EMSCRIPTEN__
    printf("当前运行环境为->js\n");
    printf("判断yuvDataCallback是否存在\n");
    printf("yuvDataCallback != nullptr  -> %d\n", yuvDataCallback != nullptr);
    if (yuvDataCallback != nullptr) {
        bool last_frame = decode_status == FINISH;
        yuvDataCallback(yuv_arr, decode_count, last_frame);
        return ret;
    }
    ret = -1;
#endif
    return ret;
}

int save_yuv_arr(int* count, AVFrame* out_frame) {
    int ret = 0;
    int linesize_y = out_frame->linesize[0];
    int linesize_u = out_frame->linesize[1];
    int linesize_v = out_frame->linesize[2];
    int width = out_frame->width;
    int height = out_frame->height;
    int buf_size_y = linesize_y * height;
    int buf_size_u = linesize_u * height / 2;
    int buf_size_v = linesize_v * height / 2;
    int play_timestamp = av_rescale_q(out_frame->pts, video_stream_time_base, av_make_q(1, 1000));
    YUVData* yuv = new YUVData;
    yuv->data_y = new uint8_t[buf_size_y];
    yuv->data_u = new uint8_t[buf_size_u];
    yuv->data_v = new uint8_t[buf_size_v];

    memcpy(yuv->data_y, out_frame->data[0], buf_size_y);
    memcpy(yuv->data_u, out_frame->data[1], buf_size_u);
    memcpy(yuv->data_v, out_frame->data[2], buf_size_v);
    printf("原始Y分量指针地址->%d\n", out_frame->data[0]);
    printf("复制后Y分量指针地址->%d\n", yuv->data_y);
    yuv->linesize_y = out_frame->linesize[0];
    yuv->linesize_u = out_frame->linesize[1];
    yuv->linesize_v = out_frame->linesize[2];
    yuv->width = out_frame->width;
    yuv->height = out_frame->height;
    yuv->pts = out_frame->pts;
    yuv->play_timestamp = play_timestamp;
    yuv->frame_number = video_dec_ctx->frame_number;
    yuv->last_frame = decode_status == FINISH;

    yuv_arr[*count] = yuv;

    return ret;
}



static int decode_packet(int decode_frame_count, int* count)
{
    int ret = 0;
    // submit the packet to the decoder
    ret = avcodec_send_packet(video_dec_ctx, decode_pkt);
    if (ret < 0) {
        printf("Error submitting a packet for decoding )\n");
        return ret;
    }

    // get all the available frames from the decoder
    while (ret >= 0) {
        ret = avcodec_receive_frame(video_dec_ctx, decode_frame);
        if (ret < 0) {
            // those two return values are special and mean there is no output
            // frame available, but there were no errors during decoding
            if (ret == AVERROR_EOF || ret == AVERROR(EAGAIN)) {
                return 0;
            }

            printf("Error during decoding ()\n");
            return ret;
        }

        printf("解码的codec->type %d\n", video_dec_ctx->codec->type);

        // write the frame data to output file
        if (video_dec_ctx->codec->type == AVMEDIA_TYPE_VIDEO) {
            int timestamp = 0;
            if (seek_timestamp) {
                timestamp = *seek_timestamp;
            }
            int64_t play_timestamp = av_rescale_q(decode_frame->pts, video_stream_time_base, av_make_q(1, 1000));
            if (play_timestamp >= timestamp) {
                printf("当前帧对应播放时间-> %lld\n", play_timestamp);
                ret = save_yuv_arr(count, decode_frame);
                #ifndef __EMSCRIPTEN__
                ret = get_jpg_data(decode_frame, video_dec_ctx);
                ret = save_jpg_arr(count, decode_frame, jpegPacket->data);
                ret = output_jpg_c(decode_frame, video_dec_ctx);
                #endif
                printf("当前帧编码: %d\n", video_dec_ctx->frame_number);
                printf("当前帧pts: %lld\n", decode_frame->pts);
                printf("当前帧dts: %lld\n", decode_frame->pkt_dts);

                *count = *count + 1;
            }
        }

        if (ret < 0)
            return ret;
    }

    return 0;
}


void flush_decode_frame() {
    av_frame_free(&decode_frame);
    av_packet_free(&decode_pkt);
    #ifndef __EMSCRIPTEN__
    av_packet_free(&jpegPacket);
    #endif
}

void on_decode_status_change(DECODE_STATUS status) {
    printf("当前解码状态码为-> %d\n", status);
    if (decodeStatusCallback != nullptr) {
        decodeStatusCallback(status);
    }
}

int handle_pause_decode() {
    decode_status = PAUSE;
    on_decode_status_change(decode_status);
    return 0;
}

int handle_seek(int timestamp) {
    int ret = 0;
    seek_timestamp = &timestamp;
    printf("传入seek时间戳->%d\n", timestamp);
    int64_t seek_target = av_rescale_q((int64_t)timestamp, av_make_q(1, 1000), video_stream_time_base);
    if (av_seek_frame(fmt_ctx, video_stream_idx, seek_target, AVSEEK_FLAG_BACKWARD) < 0) {
        printf("av_seek_frame 失败");
        ret = -1;
        return ret;
    }
    return ret;
}

int handle_decode_frame(int decode_frame_count) {
    int ret = 0;
    int count = 0;
    yuv_arr = (YUVData**)malloc(decode_frame_count * sizeof(YUVData));
    #ifndef __EMSCRIPTEN__
    jpg_arr = (JPGData**)malloc(decode_frame_count * sizeof(JPGData));
    #endif
    
    printf("开始解码\n");

    decode_status = DECODING;
    on_decode_status_change(decode_status);

    /* read frames from the file */
    while (av_read_frame(fmt_ctx, decode_pkt) >= 0 && count < decode_frame_count && decode_status == DECODING) {
        // check if the packet belongs to a stream we are interested in, otherwise
        // skip it
        if (decode_pkt->stream_index == video_stream_idx) {
            printf("读取一帧视频\n");
            ret = decode_packet(decode_frame_count, &count);
            if (ret < 0) {
                return ret;
            }
        }
    }

    if (decode_status == DECODING && count < decode_frame_count) {
        decode_status = FINISH;
        on_decode_status_change(decode_status);
    }
#ifdef __EMSCRIPTEN__
    ret = output_yuv_to_js(count);
#endif
    free_yuv_arr(count);

#ifndef __EMSCRIPTEN__
    free_jpg_arr(count);
#endif

    return ret;
}

int init_decoder(std::string _filename) {
    int ret = 0;
    const AVDictionaryEntry* tag = NULL;
    filename = _filename.c_str();
    if ((ret = avformat_open_input(&fmt_ctx, filename, NULL, NULL)) < 0)
    {
        printf("avformat_open_input -> %s", "打开文件错误\n");
        return ret;
    }
    if ((ret = avformat_find_stream_info(fmt_ctx, NULL)) < 0) {
        printf("avformat_find_stream_info -> %s", "没找到对应流\n");
        return ret;
    }
    printf("%s meta信息\n", filename);
    while ((tag = av_dict_get(fmt_ctx->metadata, "", tag, AV_DICT_IGNORE_SUFFIX)))
        printf("%s=%s\n", tag->key, tag->value);

    ret = av_find_best_stream(fmt_ctx, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    if (ret < 0) {
        printf("该视频不存在视频流!!!\n");
        return ret;
    }
    video_stream_idx = ret;
    ret = av_find_best_stream(fmt_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
    if (ret < 0) {
        printf("该视频不存在音频流!!!\n");
        return ret;
    }
    audio_stream_idx = ret;

    video_st = fmt_ctx->streams[video_stream_idx];
    printf("视频编码ID: %d\n", video_st->codecpar->codec_id);
    audio_st = fmt_ctx->streams[audio_stream_idx];
    printf("音频编码ID: %d\n", video_st->codecpar->codec_id);

    video_stream_time_base = video_st->time_base;
    audio_stream_time_base = audio_st->time_base;

    video_dec = avcodec_find_decoder(video_st->codecpar->codec_id);
    if (!video_dec) {
        printf("没有找到视频编码(%d)对应解码器，无法解码该视频\n", video_st->codecpar->codec_id);
        return 1;
    }
    audio_dec = avcodec_find_decoder(audio_st->codecpar->codec_id);
    if (!video_dec) {
        printf("没有找到音频编码(%d)对应解码器，无法解码该音频\n", audio_st->codecpar->codec_id);
        return 1;
    }

    printf("初始化视频解码器上下文...\n");
    video_dec_ctx = avcodec_alloc_context3(video_dec);

    /* Copy codec parameters from input stream to output codec context */
    if ((ret = avcodec_parameters_to_context(video_dec_ctx, video_st->codecpar)) < 0) {
        printf("Failed to copy  codec parameters to decoder context\n");
        return ret;
    }

    /* Init the decoders */
    if ((ret = avcodec_open2(video_dec_ctx, video_dec, NULL)) < 0) {
        printf("Failed to open  codec\n");
        return ret;
    }
    printf("初始化视频解码器上下文完成！\n");

    printf("初始化音频解码器上下文...\n");
    audio_dec_ctx = avcodec_alloc_context3(audio_dec);

    /* Copy codec parameters from input stream to output codec context */
    if ((ret = avcodec_parameters_to_context(audio_dec_ctx, audio_st->codecpar)) < 0) {
        printf("Failed to copy  codec parameters to decoder context\n");
        return ret;
    }

    /* Init the decoders */
    if ((ret = avcodec_open2(audio_dec_ctx, audio_dec, NULL)) < 0) {
        printf("Failed to open  codec\n");
        return ret;
    }
    printf("初始化音频解码器上下文完成！\n");

    av_dump_format(fmt_ctx, 0, filename, 0);

    decode_frame = av_frame_alloc();
    decode_pkt = av_packet_alloc();

    printf("完成初始化解码器上下!\n");

    return ret;
}

void flush_decoder() {
    avformat_close_input(&fmt_ctx);
    avcodec_free_context(&video_dec_ctx);
    avcodec_free_context(&audio_dec_ctx);
    #ifndef __EMSCRIPTEN__
    avcodec_close(jpegCodecContext);
    avcodec_free_context(&jpegCodecContext);
    #endif
}

void flush() {
    flush_decode_frame();
    flush_decoder();
}


int run(std::string filename, int decode_frame_count)
{
    // Open the file and read header.
    int ret;

    if (ret = init_decoder(filename) != 0) {
        return ret;
    }

    int seek_t = 10 * 1000;
    handle_seek(seek_t);

    printf("开始解码\n");

    ret = handle_decode_frame(decode_frame_count);

    flush();

    return ret;
}

// int main()
//  {
//        int argc = 1;
//        const char** argv;
//        const char* aa = "第一个变量";
//        const char* bb = "c:/users/19112/desktop/hevc_test_moov_set_head_16s.mp4";


//       printf("参数a %s, 参数b %s\n", aa, bb);

//       // std::string a1 = "c:/users/19112/desktop/normal_mp4.mp4";
//       std::string a1 = "c:/users/19112/desktop/hevc_test_moov_set_head_16s.mp4";

//        int timestamp = 0;
//        int decode_frame_count = 100;

//        run(a1, decode_frame_count);

//        return 0;
//    }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(structs)
{
    function("init_decoder", &init_decoder);
    function("flush", &flush);
    function("handle_decode_frame", &handle_decode_frame);
    function("handle_pause_decode", &handle_pause_decode);
    function("handle_seek", &handle_seek);
}
#endif


