import React, { useState, useEffect, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Download, ZoomIn, Trash2, Loader2, Sparkles, AlertCircle, Plus } from 'lucide-react';
import { fileToBase64, resizeImage } from './utils';
import { submitGeneration, pollResult } from './api';
import { saveHistory, getHistory, HistoryItem, deleteHistory } from './store';

const MODELS = [
  'nano-banana-fast', 'nano-banana', 'nano-banana-2', 'nano-banana-pro',
  'nano-banana-pro-vt', 'nano-banana-pro-cl', 'nano-banana-pro-vip', 'nano-banana-pro-4k-vip'
];
const SIZES = ['1K', '2K', '4K'];
const RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];

export function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('api_key') || '');
  const [garment, setGarment] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState('一个穿着这件衣服的漂亮模特，摄影级高质量，高细节');
  const [generateCount, setGenerateCount] = useState(1);
  const [selectedModel, setSelectedModel] = useState('nano-banana');
  const [imageSize, setImageSize] = useState('1K');
  const [aspectRatio, setAspectRatio] = useState('auto');
  const [viewMode, setViewMode] = useState<'front' | 'back'>('front');
  
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const garmentInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const data = await getHistory();
    setHistory(data);
    
    // Resume polling for running tasks
    data.filter(i => i.status === 'running' || i.status === 'queued').forEach(item => {
      startPolling(item.id, localStorage.getItem('api_key') || apiKey);
    });
  };

  useEffect(() => {
    localStorage.setItem('api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (selectedModel === 'nano-banana-pro-vip') {
      if (imageSize === '4K') setImageSize('2K');
    } else if (selectedModel === 'nano-banana-pro-4k-vip') {
      setImageSize('4K');
    }
  }, [selectedModel]);

  const handleGarmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const base64 = await fileToBase64(file);
      // 将前端上传时强制缩放到最大 1024，极大降低 Base64 体积，防止因为 JSON 太大导致接口拒绝连接 (413/Error)
      const resized = await resizeImage(base64, 1024);
      setGarment(resized);
    }
    if (garmentInputRef.current) garmentInputRef.current.value = '';
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + models.length > 9) {
      alert('最多上传9张模特图');
      return;
    }
    const newModels = await Promise.all(
      files.map(async f => {
        const base64 = await fileToBase64(f);
        return resizeImage(base64, 1024);
      })
    );
    setModels(prev => [...prev, ...newModels]);
    
    // 如果上传了真人模特，自动将模型切换到专门的换装大模型(vt = Virtual Try-on)以获得完美不重叠效果
    if (newModels.length > 0 && !selectedModel.includes('vt')) {
      setSelectedModel('nano-banana-pro-vt');
    }
    
    if (modelInputRef.current) modelInputRef.current.value = '';
  };

  const startPolling = (taskId: string, currentApiKey: string) => {
    const poll = async () => {
      try {
        const res = await pollResult(currentApiKey, taskId);
        if (res.code === 0 && res.data) {
          const status = res.data.status;
          setHistory(prev => {
            const newHistory = [...prev];
            const idx = newHistory.findIndex(i => i.id === taskId);
            if (idx !== -1) {
              newHistory[idx] = { 
                ...newHistory[idx], 
                status: status, 
                progress: res.data.progress || 0,
                resultUrl: res.data.results?.[0]?.url,
                error: res.data.failure_reason || res.data.error || (status === 'failed' ? '未知错误' : undefined)
              };
              saveHistory(newHistory[idx]);
            }
            return newHistory;
          });
          
          if (status === 'running' || status === 'queued') {
            setTimeout(poll, 3000);
          }
        } else if (res.code === -22) { // Queued
          setHistory(prev => {
            const newHistory = [...prev];
            const idx = newHistory.findIndex(i => i.id === taskId);
            if (idx !== -1) {
              newHistory[idx] = { ...newHistory[idx], status: 'queued' };
              saveHistory(newHistory[idx]);
            }
            return newHistory;
          });
          setTimeout(poll, 3000);
        } else {
          // Error
          setHistory(prev => {
            const newHistory = [...prev];
            const idx = newHistory.findIndex(i => i.id === taskId);
            if (idx !== -1) {
              newHistory[idx] = { ...newHistory[idx], status: 'failed', error: res.msg };
              saveHistory(newHistory[idx]);
            }
            return newHistory;
          });
        }
      } catch (err) {
        setTimeout(poll, 5000);
      }
    };
    setTimeout(poll, 3000);
  };

  const generateSingle = async (garmentData: string, modelData?: string, promptText?: string) => {
    try {
      const urls = modelData ? [garmentData, modelData] : [garmentData];
      const res = await submitGeneration({
        apiKey,
        model: selectedModel,
        prompt: promptText || "一个穿着这件衣服的漂亮模特",
        aspectRatio,
        imageSize,
        urls
      });

      if (res.code === 0 && res.data?.id) {
        const newItem: HistoryItem = {
          id: res.data.id,
          garment: garmentData,
          modelImage: modelData,
          prompt: promptText,
          status: 'queued',
          progress: 0,
          timestamp: Date.now()
        };
        await saveHistory(newItem);
        setHistory(prev => [newItem, ...prev]);
        startPolling(res.data.id, apiKey);
      } else {
        alert("生成请求失败: " + (res.msg || res.error || "接口异常或余额不足，请稍后重试"));
      }
    } catch (err) {
      alert("网络请求失败: 图片可能过大或网络超时");
    }
  };

  const handleGenerate = async () => {
    if (!apiKey) return alert('请先输入 API Key');
    if (!garment) return alert('请上传平铺服装图');
    
    setIsGenerating(true);
    
    if (models.length > 0) {
      for (const modelImg of models) {
        // 【防违规优化】移除可能触发敏感词拦截的 "body shape", "body curves" 词汇，缩减过长提示词
        let tryOnPrompt = "virtual try-on, exactly preserve original person's pose, hand gestures, face and background. new garment drape naturally with 3D fabric folds. graphic print or logo must warp naturally along fabric folds, seamless integration, high quality, photorealistic.";
        
        if (viewMode === 'back') {
          tryOnPrompt = "back view, exactly preserve original person's pose from behind, facing away from camera. new garment worn properly showing back side. natural fabric draping, 3D clothing wrinkles, graphic print on back warps naturally, perfect clothing replacement, photorealistic.";
        }

        // 自动将模型切换到可能专门用于换装的 vt (Virtual Try-on) 模型，以获得最佳换装效果，防止叠加
        const actualModel = selectedModel.includes('vt') ? selectedModel : 'nano-banana-pro-vt';
        
        try {
          const res = await submitGeneration({
            apiKey,
            model: actualModel,
            prompt: tryOnPrompt,
            aspectRatio,
            imageSize,
            urls: [modelImg, garment] // 注意：通常换装API的图1(基底图)是模特，图2是衣服
          });

          if (res.code === 0 && res.data?.id) {
            const newItem: HistoryItem = {
              id: res.data.id,
              garment: garment,
              modelImage: modelImg,
              prompt: tryOnPrompt,
              status: 'queued',
              progress: 0,
              timestamp: Date.now()
            };
            await saveHistory(newItem);
            setHistory(prev => [newItem, ...prev]);
            startPolling(res.data.id, apiKey);
          } else {
            alert("生成请求失败: " + (res.msg || res.error || "接口异常或余额不足，请稍后重试"));
          }
        } catch (err) {
          alert("网络请求失败: 图片可能过大或网络超时");
        }
        // 增加排队请求的间隔，防止被 API 接口限流拦截导致“经常失败”
        await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      for (let i = 0; i < generateCount; i++) {
        await generateSingle(garment, undefined, `${customPrompt} [variation ${i+1}]`);
        // 同理，增加连续排队的间隔防止被限流
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    setIsGenerating(false);
  };

  const downloadImage = (url: string) => {
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tryon_result_${Date.now()}.png`;
        a.click();
      });
  };

  const handleDeleteHistory = async (id: string) => {
    await deleteHistory(id);
    setHistory(prev => prev.filter(i => i.id !== id));
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white shadow-sm border-b px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-600" />
          <h1 className="text-xl font-bold text-gray-800">AI 虚拟换装实验室</h1>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="password"
            placeholder="输入您的 API Key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="px-4 py-2 border rounded-md text-sm w-64 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Inputs */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 w-6 h-6 flex items-center justify-center rounded-full text-sm">1</span>
              上传平铺服装图 (必填)
            </h2>
            <div 
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:bg-gray-50 transition"
              onClick={() => garmentInputRef.current?.click()}
            >
              <input type="file" ref={garmentInputRef} hidden accept="image/*" onChange={handleGarmentUpload} />
              {garment ? (
                <div className="relative inline-block">
                  <img src={garment} className="max-h-48 rounded object-contain mx-auto" alt="服装" />
                  <button onClick={(e) => { e.stopPropagation(); setGarment(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center text-gray-500">
                  <Upload className="w-8 h-8 mb-2 text-gray-400" />
                  <p>点击上传服装图</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 w-6 h-6 flex items-center justify-center rounded-full text-sm">2</span>
              模特设置 (选填)
            </h2>
            
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">上传真人模特图 (最多9张)</label>
                <span className="text-xs text-gray-500">{models.length}/9</span>
              </div>
              <p className="text-xs text-indigo-600 mb-2">
                * 若上传模特图，系统会自动使用专门的 <b>vt (Virtual Try-on)</b> 换装模型，可防止出现衣服叠加和模特脸部变更。
              </p>
              <div className="flex flex-wrap gap-2">
                {models.map((img, idx) => (
                  <div key={idx} className="relative w-20 h-20 border rounded-md group">
                    <img src={img} className="w-full h-full object-cover rounded-md" alt={`模特${idx}`} />
                    <button onClick={() => setModels(m => m.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hidden group-hover:block">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {models.length < 9 && (
                  <div 
                    onClick={() => modelInputRef.current?.click()}
                    className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-md flex items-center justify-center cursor-pointer hover:bg-gray-50 text-gray-400"
                  >
                    <Plus className="w-6 h-6" />
                    <input type="file" ref={modelInputRef} hidden accept="image/*" multiple onChange={handleModelUpload} />
                  </div>
                )}
              </div>
            </div>

            {models.length === 0 && (
              <div className="bg-orange-50 p-4 rounded-md border border-orange-100 mt-4">
                <p className="text-sm text-orange-800 mb-2 font-medium">未上传模特图，将使用自定义提示词自动生成模特</p>
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  className="w-full text-sm border-gray-300 rounded p-2 focus:ring-indigo-500 outline-none border"
                  rows={2}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-gray-600">生成数量：</span>
                  <select value={generateCount} onChange={e => setGenerateCount(Number(e.target.value))} className="border rounded p-1 text-sm outline-none">
                    {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n} 张</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 w-6 h-6 flex items-center justify-center rounded-full text-sm">3</span>
              设置参数
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">选择模型</label>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} className="w-full border rounded p-2 text-sm outline-none">
                  {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">生成尺寸</label>
                <select 
                  value={imageSize} 
                  onChange={e => setImageSize(e.target.value)} 
                  disabled={selectedModel === 'nano-banana-pro-4k-vip'}
                  className="w-full border rounded p-2 text-sm outline-none disabled:bg-gray-100"
                >
                  {SIZES.map(s => {
                    if (selectedModel === 'nano-banana-pro-vip' && s === '4K') return null;
                    return <option key={s} value={s}>{s}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">图片比例 (选auto保持动作)</label>
                <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="w-full border rounded p-2 text-sm outline-none">
                  {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">换装视角</label>
                <select value={viewMode} onChange={e => setViewMode(e.target.value as 'front' | 'back')} className="w-full border rounded p-2 text-sm outline-none">
                  <option value="front">正面换装</option>
                  <option value="back">背面换装</option>
                </select>
              </div>
            </div>

            {viewMode === 'back' && (
              <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded text-xs text-indigo-700">
                <p><b>提示：</b> 背面换装时，请务必同时上传 <b>背面的平铺服装图</b> 和 <b>背面的模特图</b>，效果最佳。</p>
              </div>
            )}
            
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !garment || !apiKey}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium py-3 rounded-lg flex items-center justify-center transition"
            >
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : "立即生成"}
            </button>
          </div>
        </div>

        {/* Right Column - History */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-[calc(100vh-8rem)]">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">生成记录</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                <p>暂无生成记录</p>
              </div>
            ) : (
              history.map(item => (
                <div key={item.id} className="border rounded-lg p-4 flex gap-4 bg-gray-50 relative">
                  <button onClick={() => handleDeleteHistory(item.id)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  
                  <div className="flex flex-col gap-2 shrink-0">
                    <img src={item.garment} className="w-16 h-16 object-cover rounded border" alt="服装" />
                    {item.modelImage ? (
                      <img src={item.modelImage} className="w-16 h-16 object-cover rounded border" alt="模特" />
                    ) : (
                      <div className="w-16 h-16 bg-white border rounded flex items-center justify-center text-xs text-center text-gray-400 p-1" title={item.prompt}>
                        AI生成模特
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-center border-l pl-4">
                    {item.status === 'succeeded' && item.resultUrl ? (
                      <div className="relative group w-32 h-32">
                        <img 
                          src={item.resultUrl} 
                          className="w-full h-full object-cover rounded shadow cursor-pointer" 
                          alt="结果" 
                          onClick={() => setPreviewImage(item.resultUrl!)}
                        />
                        <div className="absolute top-1 right-1 flex gap-1">
                          <button onClick={() => downloadImage(item.resultUrl!)} className="bg-white/80 p-1 rounded hover:bg-white text-gray-800 shadow">
                            <Download className="w-4 h-4" />
                          </button>
                          <button onClick={() => setPreviewImage(item.resultUrl!)} className="bg-white/80 p-1 rounded hover:bg-white text-gray-800 shadow">
                            <ZoomIn className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : item.status === 'failed' ? (
                      <div className="text-red-500 flex items-center text-sm gap-1">
                        <AlertCircle className="w-4 h-4" />
                        生成失败 {item.error && `(${item.error})`}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-32 w-32 bg-gray-100 rounded">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                        <span className="text-xs text-gray-600">
                          {item.status === 'queued' ? '排队中...' : `生成中 ${item.progress}%`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Preview */}
      {previewImage && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center" onClick={() => setPreviewImage(null)}>
          <button className="absolute top-4 right-4 text-white hover:text-gray-300">
            <X className="w-8 h-8" />
          </button>
          <img src={previewImage} className="max-w-[90%] max-h-[85vh] object-contain rounded" onClick={e => e.stopPropagation()} alt="预览" />
          <button 
            onClick={(e) => { e.stopPropagation(); downloadImage(previewImage); }}
            className="mt-6 bg-white text-black px-6 py-2 rounded-full font-medium flex items-center gap-2 hover:bg-gray-200"
          >
            <Download className="w-5 h-5" /> 下载原图
          </button>
        </div>
      )}
    </div>
  );
}