#include <stdio.h>
#include <iostream>

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
};

#ifdef __EMSCRIPTEN__
// Define a callback function type
typedef void (*YUVDataCallback)(unsigned char* data_y, unsigned char* data_u, unsigned char* data_v, int line1, int line2, int line3, int width, int height);

// Declare the callback function
YUVDataCallback yuvDataCallback = nullptr;

extern "C" {
    EMSCRIPTEN_KEEPALIVE
        void setYUVDataCallback(YUVDataCallback callback) {
            printf("设置回调函数------------------");
        yuvDataCallback = callback;
    }
}
#endif

typedef struct Response
{
    std::string format;
    int duration;
    int streams;
} Response;

typedef struct ImageData {
    uint32_t width;
    uint32_t height;
    uint32_t duration;
    uint8_t* data;
} ImageData;

static AVFormatContext* fmt_ctx;
static int video_stream_idx = -1, audio_stream_idx = -1;
static AVCodecContext* video_dec_ctx, * audio_dec_ctx;
int video_frame_count = 0;
bool has_decode_video = false;
static int video_dst_bufsize;
static uint8_t* video_dst_data[4] = { NULL };
static int      video_dst_linesize[4];
static int width, height;
static enum AVPixelFormat pix_fmt;
static FILE* video_dst_file = NULL;
static const char *video_dst_filename = "C:/Users/19112/Desktop/video_capture/test.jpg";

// SAVE THE FILE
static void save(unsigned char* buf, int wrap, int x_size, int y_size, const char* file_name) {
    printf("开始保存文件\n");


    // INIT THE EMPTY FILE
    FILE* file;

    // OPEN AND WRITE THE IMAGE FILE
    file = fopen(file_name, "wb");
    for (int i = 0; i < y_size; i++) {
        fwrite(buf + i * wrap, 1, x_size * 3, file);
    }
    fclose(file);
}

static int output_video_frame(AVFrame* frame, AVCodecContext* video_dec_ctx)
{
    printf("video_frame n:%d coded_n:%d\n",
        video_frame_count++, frame->coded_picture_number);

    printf("完成解码一帧\n");

    /*
     * JPG 
    const AVCodec* jpegCodec = avcodec_find_encoder(AV_CODEC_ID_MJPEG);
    AVCodecContext* jpegCodecContext = avcodec_alloc_context3(jpegCodec);
    jpegCodecContext->width = frame->width;
    jpegCodecContext->height = frame->height;
    jpegCodecContext->pix_fmt = AV_PIX_FMT_YUVJ420P;
    jpegCodecContext->time_base = av_inv_q(video_dec_ctx->framerate);
    avcodec_open2(jpegCodecContext, jpegCodec, nullptr);
    AVPacket jpegPacket;
    av_init_packet(&jpegPacket);

    if (avcodec_send_frame(jpegCodecContext, frame) == 0 &&
        avcodec_receive_packet(jpegCodecContext, &jpegPacket) == 0) {
        FILE* jpegFile = fopen(video_dst_filename, "wb");
        fwrite(jpegPacket.data, 1, jpegPacket.size, jpegFile);
        fclose(jpegFile);
        avcodec_close(jpegCodecContext);
        avcodec_free_context(&jpegCodecContext);
    }
    */
#ifndef __EMSCRIPTEN__
    FILE* yuvFile = fopen("C:/Users/19112/Desktop/video_capture/output_frame.yuv", "wb");
    for (int i = 0; i < frame->height; i++) {
        fwrite(frame->data[0] + i * frame->linesize[0], 1, frame->width, yuvFile);
    }
    for (int i = 0; i < frame->height / 2; i++) {
        fwrite(frame->data[1] + i * frame->linesize[1], 1, frame->width / 2, yuvFile);
    }
    for (int i = 0; i < frame->height / 2; i++) {
        fwrite(frame->data[2] + i * frame->linesize[2], 1, frame->width / 2, yuvFile);
    }
#endif

#ifdef __EMSCRIPTEN__
    printf("判断yuvDataCallback是否存在\n");
    printf("yuvDataCallback != nullptr  -> %d", yuvDataCallback != nullptr);
    if (yuvDataCallback != nullptr) {
        printf("存在callback，执行回调函数");
        printf("frame->width :%d, frame->height %d", frame->width, frame->height);
        yuvDataCallback(frame->data[0], frame->data[1], frame->data[2], frame->linesize[0], frame->linesize[1], frame->linesize[2], frame->width, frame->height);
    }
#endif

    return 0;
}

static int decode_packet(AVCodecContext* dec, const AVPacket* pkt, AVFrame *frame)
{
    int ret = 0;

    // submit the packet to the decoder
    ret = avcodec_send_packet(dec, pkt);
    if (ret < 0) {
        printf("Error submitting a packet for decoding )\n");
        return ret;
    }

    // get all the available frames from the decoder
    while (ret >= 0) {
        ret = avcodec_receive_frame(dec, frame);
        if (ret < 0) {

            // those two return values are special and mean there is no output
            // frame available, but there were no errors during decoding
            if (ret == AVERROR_EOF || ret == AVERROR(EAGAIN)) {
                return 0;
            }


            printf("Error during decoding ()\n");
            return ret;
        }

        printf("解码的codec->type %d\n", dec->codec->type);

        // write the frame data to output file
        if (dec->codec->type == AVMEDIA_TYPE_VIDEO) {
            ret = output_video_frame(frame, dec);
            printf("当前帧编码: %d\n", dec->frame_number);
            printf("解码后ret: %d\n", ret);
            has_decode_video = true;
            return 2;
        }
            

        av_frame_unref(frame);
        if (ret <= 0)
            return ret;
    }

    return 0;
}

AVFrame* initAVFrame(AVCodecContext* pCodecCtx, uint8_t** frameBuffer) {
    AVFrame* pFrameRGB = av_frame_alloc();
    if (pFrameRGB == NULL) {
        return NULL;
    }

    int numBytes;
    numBytes = av_image_get_buffer_size(AV_PIX_FMT_RGB24, pCodecCtx->width, pCodecCtx->height, 1);
    video_dst_bufsize = numBytes;

    *frameBuffer = (uint8_t*)av_malloc(numBytes * sizeof(uint8_t));

    av_image_fill_arrays(pFrameRGB->data, pFrameRGB->linesize, *frameBuffer, AV_PIX_FMT_RGB24, pCodecCtx->width, pCodecCtx->height, 1);

    return pFrameRGB;
}

// 读取帧数据并返回 uint8 buffer
uint8_t* getFrameBuffer(AVFrame* pFrame, AVCodecContext* pCodecCtx) {
    int width = pCodecCtx->width;
    int height = pCodecCtx->height;

    uint8_t* buffer = (uint8_t*)malloc(height * width * 3);
    for (int y = 0; y < height; y++) {
        memcpy(buffer + y * pFrame->linesize[0], pFrame->data[0] + y * pFrame->linesize[0], width * 3);
    }

    return buffer;
}


Response run(std::string filename)
{
    // Open the file and read header.
    int ret;
    int stream_index;
    AVStream* video_st = NULL;
    const AVCodec* dec = NULL;
    const AVDictionaryEntry* tag = NULL;
    AVFrame* frame;
    AVPacket* pkt;
    struct SwsContext* sws_ctx = NULL;
    uint8_t* frameBuffer;
    ImageData* imageData = NULL;

    
    if ((ret = avformat_open_input(&fmt_ctx, filename.c_str(), NULL, NULL)) < 0)
    {
        printf("%s", "打开文件错误");
    }

    if ((ret = avformat_find_stream_info(fmt_ctx, NULL)) < 0) {
        av_log(NULL, AV_LOG_ERROR, "Cannot find stream information\n");
    }

    while ((tag = av_dict_get(fmt_ctx->metadata, "", tag, AV_DICT_IGNORE_SUFFIX)))
        printf("%s=%s\n", tag->key, tag->value);

    ret = av_find_best_stream(fmt_ctx, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    if (ret < 0) {
        printf("该视频不存在视频流!!!\n");
    }
    stream_index = ret;
    video_st = fmt_ctx->streams[stream_index];
    printf("编码ID: %d\n", video_st->codecpar->codec_id);
    dec = avcodec_find_decoder(video_st->codecpar->codec_id);
    if (!dec) {
        printf("没有找到对应解码器，无法解码该视频\n");
    }
    else {
        printf("找到对应解码器，准备解码\n");
    }

    video_dec_ctx = avcodec_alloc_context3(dec);

    /* Copy codec parameters from input stream to output codec context */
    if ((ret = avcodec_parameters_to_context(video_dec_ctx, video_st->codecpar)) < 0) {
        printf("Failed to copy  codec parameters to decoder context\n");
    }

    /* Init the decoders */
    if ((ret = avcodec_open2(video_dec_ctx, dec, NULL)) < 0) {
        printf("Failed to open  codec\n");
    }

    printf("初始化解码器完成!!!!\n");

    /* dump input information to stderr */
    av_dump_format(fmt_ctx, 0, filename.c_str(), 0);

    frame = av_frame_alloc();
    pkt = av_packet_alloc();

    printf("开始解码\n");

    /* read frames from the file */
    while (av_read_frame(fmt_ctx, pkt) >= 0 && !has_decode_video) {
        // check if the packet belongs to a stream we are interested in, otherwise
        // skip it
        printf("pkt->stream_index %d, stream_index %d\n", pkt->stream_index, stream_index);
        if (pkt->stream_index == stream_index) {
            printf("读取一帧视频\n");
            ret = decode_packet(video_dec_ctx, pkt, frame);
            if (ret == 2) {
                av_packet_unref(pkt);
                break;
            }
        }
        av_packet_unref(pkt);
    }

    printf("开始转换rgb图片，等比不缩放\n");


    printf("转换rgb图片完成，尺寸 宽: %d, 高: %d\n", video_dec_ctx->width, video_dec_ctx->height);


    // Read container data.
    printf("format: %s, duration: %lld us, streams: %d\n",
        fmt_ctx->iformat->name,
        fmt_ctx->duration,
        fmt_ctx->nb_streams);

    // Initialize response struct with format data.
    Response r = {
        .format = fmt_ctx->iformat->name,
        .duration = (int)fmt_ctx->duration,
        .streams = (int)fmt_ctx->nb_streams,
    };

    sws_freeContext(sws_ctx);
    avformat_close_input(&fmt_ctx);
    avcodec_free_context(&video_dec_ctx);
    av_packet_free(&pkt);
    av_frame_free(&frame);

    return r;
}

// int main()
// {
//     int argc = 1;
//     const char** argv;
//     const char* aa = "第一个变量";
//     const char* bb = "C:/Users/19112/Desktop/hevc_test_moov_set_head_16s.mp4";


//     printf("参数a %s, 参数b %s\n", aa, bb);

//     std::string a1 = "C:/Users/19112/Desktop/normal_mp4.mp4";

//     run(a1);

//     cout << "Hello CMake." << endl;
//     unsigned int a = avcodec_version();
//     printf("avcodec版本 %d", a);
//     return 0;
// }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(structs)
{
    emscripten::value_object<Response>("Response")
        .field("format", &Response::format);
    function("run", &run);
}
#endif


