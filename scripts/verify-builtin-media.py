"""Independent small-fixture oracles; never imports MoDiff or runs a graph/model.

Input filenames have already passed the canonical recorder's containment/hash
checks. Decoding and numerical limits below bound verification, not user media.
"""
import hashlib
import io
import json
import math
import sys

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from scipy.io import wavfile


def digest_image(image):
    body = image.tobytes()
    return dict(kind='image', sha256=hashlib.sha256(body).hexdigest(), byteSize=len(body),
                width=image.width, height=image.height, mode=image.mode)


def audio(path):
    rate, samples = wavfile.read(path)
    assert samples.dtype == np.int16 and 8000 <= rate <= 96000
    assert samples.shape[0] <= 960_000
    samples = samples.astype(np.float32) / 32768
    if samples.ndim == 1:
        samples = samples[:, None]
    assert samples.ndim == 2 and samples.shape[1] <= 8 and np.isfinite(samples).all()
    return samples, int(rate)


def digest_audio(samples, rate):
    data = np.ascontiguousarray(samples, dtype='<f4').tobytes()
    return dict(kind='audio', sha256=hashlib.sha256(data).hexdigest(), byteSize=len(data),
                shape=list(samples.shape), sampleRate=rate, dtype='float32-le')


def video(path):
    reader = imageio.get_reader(path, 'ffmpeg', input_params=['-protocol_whitelist', 'file,pipe'])
    try:
        count = reader.count_frames()
        assert 0 < count <= 512
        meta = reader.get_meta_data()
        assert max(meta['size']) <= 2048
        frames = [frame for frame in reader]
        assert len(frames) == count
        return frames, float(meta['fps'])
    finally:
        reader.close()


def images(request, controls):
    loaded = {}
    roots = {}
    for binding in request['inputs']:
        items = []
        for row in binding['values']:
            with Image.open(row['path']) as opened:
                assert opened.width * opened.height <= 4_194_304
                image = ImageOps.exif_transpose(opened).copy()
            alpha = request['nodeControls'][binding['nodeId']].get('alpha_channel', 'ignore')
            if alpha == 'remove alpha' and image.mode == 'RGBA':
                image = image.convert('RGB')
            elif alpha == 'add alpha':
                image = image.convert('RGBA')
            items.append(image)
        loaded[binding['nodeId']] = items
        roots[binding['nodeId']] = [digest_image(image) for image in items]
    source = loaded[request['primarySource']]
    image = source[0]
    mode = request['mode']
    if mode == 'image_crop':
        x, y = controls['x'], controls['y']
        expected = [image.crop((x, y, x + (controls['width'] or image.width-x),
                                y + (controls['height'] or image.height-y)))]
    elif mode == 'image_upscale':
        method = {'nearest': Image.Resampling.NEAREST, 'lanczos': Image.Resampling.LANCZOS}[controls['resize_resampling']]
        expected = [ImageOps.contain(image, (controls['resize_width'], controls['resize_height']), method=method)]
    elif mode == 'image_channels':
        expected = [image.convert('L') if controls['channel'] == 'luminance' else image.getchannel('R')]
    elif mode == 'image_adjustment':
        expected = [ImageEnhance.Brightness(image).enhance(controls['brightness'])]
    elif mode == 'image_filter':
        assert controls['filter_operation'] == 'gaussian_blur'
        expected = [image.filter(ImageFilter.GaussianBlur(controls['amount']))]
    elif mode == 'image_tile':
        rows, columns = controls['rows'], controls['columns']
        expected = [image.crop((round(c*image.width/columns), round(r*image.height/rows),
                                round((c+1)*image.width/columns), round((r+1)*image.height/rows)))
                    for r in range(rows) for c in range(columns)]
    elif mode == 'image_stitch':
        columns, gap = controls['stitch_columns'], controls['stitch_spacing']
        rows = math.ceil(len(source)/columns)
        expected = [Image.new('RGB',(columns*image.width+(columns-1)*gap,rows*image.height+(rows-1)*gap),
                              controls['stitch_background'])]
        for index, item in enumerate(source):
            expected[0].paste(item, ((index%columns)*(image.width+gap),(index//columns)*(image.height+gap)))
    elif mode == 'mask_composite':
        mask = loaded[request['maskSource']][0].convert('L')
        if controls['composite_invert_mask']:
            mask = ImageOps.invert(mask)
        expected = [Image.composite(source[1],source[0],mask)]
    else:
        raise ValueError('Unsupported image oracle')
    assert len(expected) == len(request['rawOutputs'])
    for expected_image,row in zip(expected,request['rawOutputs'],strict=True):
        with Image.open(row['path']) as actual:
            assert digest_image(actual) == digest_image(expected_image), 'exact processed pixels differ'
    assert len(expected) == len(request['durableOutputs'])
    for expected_image,row in zip(expected,request['durableOutputs'],strict=True):
        with Image.open(row['path']) as actual:
            assert actual.size == expected_image.size
            encoded=io.BytesIO();expected_image.save(encoded,format='WEBP',quality=100)
            assert encoded.getvalue()==open(row['path'],'rb').read(), 'durable preview differs from the declared WebP100 encoding'
    return {'rootDecoded':roots,'processedImages':[digest_image(image) for image in expected],
            'checks':['exact pixels','geometry','complete ordered output collection']}


def audios(request, controls):
    loaded = {binding['nodeId']: audio(binding['values'][0]['path']) for binding in request['inputs']}
    source, rate = loaded[request['primarySource']]
    actual, output_rate = audio(request['durableOutputs'][0]['path'])
    assert output_rate == rate == 48000 and actual.shape[1] == source.shape[1]
    reference = loaded[request['referenceSource']][0] if request.get('referenceSource') else None
    mode = request['mode']
    expected_digest = None
    if mode == 'audio_trim':
        start = round(controls['start_seconds']*rate)
        count = round(controls['duration_seconds']*rate) if controls['duration_seconds'] else len(source)-start
        expected = source[start:start+count]
        expected_digest = digest_audio(expected,rate)
    elif mode == 'audio_join':
        a,b = source.copy(),reference.copy()
        count = round(controls['boundary_fade_seconds']*rate)
        if count:
            phase=np.linspace(0,np.pi/2,count)
            a[-count:] *= np.cos(phase).astype(np.float32)[:,None]
            b[:count] *= np.sin(phase).astype(np.float32)[:,None]
        expected=np.concatenate([a,b])
        expected_digest=digest_audio(expected,rate)
    else:
        assert mode == 'audio_loudness_match' and actual.shape == source.shape
        # These paired tones share frequency/layout and differ only in level.
        expected_gain=min(controls['max_adjustment_db'],20*np.log10(np.linalg.norm(reference)/np.linalg.norm(source)))
        gain=float(np.sum(actual*source,dtype=np.float64)/np.sum(source*source,dtype=np.float64))
        assert abs(20*np.log10(gain)-expected_gain) < .15, 'loudness gain differs'
        expected=source*gain
        assert np.max(np.abs(actual-expected)) < 2/32768, 'gain is not constant'
        assert np.max(np.abs(actual)) <= 10**(controls['target_peak_dbfs']/20)+2/32768
    assert actual.shape == expected.shape
    assert np.max(np.abs(actual-expected)) < 2/32768, 'PCM samples differ'
    return {'rootDecoded':{key:[digest_audio(*value)] for key,value in loaded.items()},
            'processedAudio':expected_digest,'checks':['sample rate/channels/count','sample alignment within two PCM16 units',
               'join order and fades' if mode=='audio_join' else 'trim boundaries' if mode=='audio_trim' else 'constant bounded loudness gain']}


def videos(request, controls):
    sources=[video(row['path']) for binding in request['inputs'] for row in binding['values']]
    frames,rate=sources[0]
    mode=request['mode']
    if mode=='video_frame_extract':
        indices=[0,len(frames)-1] if controls['selection_mode']=='first_last' else [int(v) for v in controls['indices'].split(',')]
        expected=[frames[i] for i in indices]
        assert len(expected)==len(request['rawOutputs'])
        for frame,row in zip(expected,request['rawOutputs'],strict=True):
            with Image.open(row['path']) as actual:assert np.array_equal(np.asarray(actual),frame)
        assert len(expected)==len(request['durableOutputs'])
        for frame,row in zip(expected,request['durableOutputs'],strict=True):
            with Image.open(row['path']) as actual:
                assert actual.size==Image.fromarray(frame).size
                encoded=io.BytesIO();Image.fromarray(frame).save(encoded,format='WEBP',quality=100)
                assert encoded.getvalue()==open(row['path'],'rb').read(), 'durable frame preview differs from WebP100'
        return {'rootDecoded':{},'processedImages':[digest_image(Image.fromarray(frame)) for frame in expected],
                'checks':['exact selected frame pixels','frame indices and order']}
    if mode=='video_reverse':
        expected=frames[::-1];processed_rate=rate
    elif mode=='video_trim':
        end=controls['end_seconds'] or len(frames)/rate
        expected=frames[round(controls['start_seconds']*rate):round(end*rate)];processed_rate=rate
    elif mode=='video_stitch':
        assert all(value[1]==rate for value in sources)
        expected=[frame for seq,_ in sources for frame in seq];processed_rate=rate
    elif mode=='video_tile':
        columns=min(controls['columns'],len(sources));gap=controls['gap'];rows=math.ceil(len(sources)/columns)
        h,w=frames[0].shape[:2];expected=[];processed_rate=rate
        for index in range(max(len(value[0]) for value in sources)):
            canvas=np.full((rows*h+(rows-1)*gap,columns*w+(columns-1)*gap,3),255 if controls['background']=='white' else 0,dtype=np.uint8)
            for n,(seq,_) in enumerate(sources):
                y,x=(n//columns)*(h+gap),(n%columns)*(w+gap)
                canvas[y:y+h,x:x+w]=seq[min(index,len(seq)-1)]
            expected.append(canvas)
    else:
        assert mode=='frame_interpolation';processed_rate=controls['interpolation_fps'];expected=[]
        for index in range(round(len(frames)/rate*processed_rate)):
            position=index/processed_rate*rate;left=min(int(position),len(frames)-1);right=min(left+1,len(frames)-1)
            fraction=position-int(position)
            expected.append(np.rint(frames[left].astype(float)*(1-fraction)+frames[right]*fraction).astype(np.uint8))
    processed,actual_rate=video(request['intermediate']['path'])
    assert actual_rate==processed_rate and len(processed)==len(expected), 'processed rate/count differs'
    errors=[float(np.abs(a.astype(float)-b.astype(float)).mean()) for a,b in zip(processed,expected,strict=True)]
    assert max(errors)<5, ('processed pixels or sequence differs',max(errors))
    delivered,delivery_rate=video(request['durableOutputs'][0]['path'])
    assert delivery_rate==request['exportControls']['fps'] and len(delivered)==len(processed)
    for actual,source in zip(delivered,processed,strict=True):
        h,w=source.shape[:2];target=(math.ceil(w/16)*16,math.ceil(h/16)*16)
        assert actual.shape[1::-1]==target
        if actual.shape!=source.shape:source=np.asarray(Image.fromarray(source).resize(target,Image.Resampling.BICUBIC))
        assert np.abs(actual.astype(float)-source.astype(float)).mean()<5
    return {'rootDecoded':{},'checks':['source sequence and timing','processed geometry/FPS/frame count',
            'all decoded frames within codec tolerance','actual delivery geometry and requested FPS'],
            'maximumMeanPixelError':max(errors),'deliveryDimensions':list(delivered[0].shape[1::-1]),
            'deliveryFrames':len(delivered),'deliveryFps':delivery_rate,'audioClaim':False}


request=json.load(sys.stdin)
controls=request['controls']
if request['mode'].startswith('audio_'):result=audios(request,controls)
elif request['modelType']=='BuiltinImageOperation':result=images(request,controls)
else:result=videos(request,controls)
print(json.dumps({'status':'passed',**result},allow_nan=False))
