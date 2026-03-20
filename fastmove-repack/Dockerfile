FROM suarez123/wan22-i2v:fastmove-v2-fp8

COPY wan22EnhancedNSFWSVICamera_nsfwV2FP8H.safetensors /comfyui/models/diffusion_models/
COPY wan22EnhancedNSFWSVICamera_nsfwV2FP8L.safetensors /comfyui/models/diffusion_models/

RUN rm -f /comfyui/models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2FP8H.safetensors \
          /comfyui/models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2FP8L.safetensors \
 && ln -s /comfyui/models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwV2FP8H.safetensors \
          /comfyui/models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2FP8H.safetensors \
 && ln -s /comfyui/models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwV2FP8L.safetensors \
          /comfyui/models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2FP8L.safetensors
