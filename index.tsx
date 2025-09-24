/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, GeneratedImage, Modality} from '@google/genai';

// --- DOM ELEMENT REFERENCES ---
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const imageUploadInput = document.getElementById('image-upload-input') as HTMLInputElement;
const imagePreviewContainer = document.getElementById('image-preview-container');
const aspectRatioSelect = document.getElementById('aspect-ratio-select') as HTMLSelectElement;
const numImagesSlider = document.getElementById('num-images-slider') as HTMLInputElement;
const numImagesValue = document.getElementById('num-images-value');
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const loader = document.getElementById('loader');
const imageGallery = document.getElementById('image-gallery');

// --- STATE MANAGEMENT ---
let uploadedImages: {
    base64: string;
    mimeType: string;
} [] = [];

// --- API INITIALIZATION ---
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// --- EVENT LISTENERS ---

// Update number of images display
numImagesSlider?.addEventListener('input', () => {
    if (numImagesValue) {
        numImagesValue.textContent = numImagesSlider.value;
    }
});

// Handle image upload
imageUploadInput?.addEventListener('change', async (event) => {
    const files = (event.target as HTMLInputElement).files;
    if (!files || files.length === 0) {
        return;
    }

    const readPromises = Array.from(files).map(file => {
        return new Promise<{base64: string, mimeType: string}>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                resolve({ base64: base64String, mimeType: file.type });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    });

    try {
        const newImages = await Promise.all(readPromises);
        uploadedImages.push(...newImages);
        renderImagePreviews();
        updateUiForMode();
    } catch (error) {
        console.error("Error reading files:", error);
        alert("Произошла ошибка при чтении файлов.");
    }
});

// Main generate button click handler
generateBtn?.addEventListener('click', async () => {
    if (!promptInput.value.trim()) {
        alert('Пожалуйста, введите промпт.');
        return;
    }

    setLoading(true);
    clearGallery();

    try {
        if (uploadedImages.length > 0) {
            await editImage();
        } else {
            await generateImages();
        }
    } catch (error) {
        console.error('Error:', error);
        displayError('Произошла ошибка. Пожалуйста, проверьте консоль для получения дополнительной информации.');
    } finally {
        setLoading(false);
    }
});


// --- UI UPDATE FUNCTIONS ---

function setLoading(isLoading: boolean) {
    loader?.classList.toggle('hidden', !isLoading);
    if (generateBtn) generateBtn.disabled = isLoading;
}

function clearGallery() {
    if (imageGallery) imageGallery.innerHTML = '';
}

function displayError(message: string) {
    if (imageGallery) {
        imageGallery.innerHTML = `<p class="placeholder-text" style="color: #cf6679;">${message}</p>`;
    }
}

// Disable/enable generation settings based on whether an image is uploaded
function updateUiForMode() {
    const isEditing = uploadedImages.length > 0;
    if (aspectRatioSelect) aspectRatioSelect.disabled = isEditing;
    if (numImagesSlider) numImagesSlider.disabled = isEditing;
    
    const settings = document.querySelector('.settings-section') as HTMLElement;
    if(settings) {
        settings.style.opacity = isEditing ? '0.5' : '1';
        settings.style.pointerEvents = isEditing ? 'none' : 'auto';
    }
}

function renderImagePreviews() {
    if (!imagePreviewContainer) return;

    imagePreviewContainer.innerHTML = ''; // Clear existing previews

    uploadedImages.forEach((image, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-thumbnail';

        const img = document.createElement('img');
        img.src = `data:${image.mimeType};base64,${image.base64}`;
        img.alt = `Uploaded image ${index + 1}`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-image-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.setAttribute('aria-label', `Remove image ${index + 1}`);
        removeBtn.addEventListener('click', () => {
            removeImage(index);
        });

        wrapper.appendChild(img);
        wrapper.appendChild(removeBtn);
        imagePreviewContainer.appendChild(wrapper);
    });
}

function removeImage(index: number) {
    uploadedImages.splice(index, 1);
    if (imageUploadInput) imageUploadInput.value = ''; // Reset file input to allow re-uploading
    renderImagePreviews();
    updateUiForMode();
}

// --- API CALLS ---

/**
 * Generates images from a text prompt using Imagen.
 */
async function generateImages() {
    const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: promptInput.value,
        config: {
            numberOfImages: parseInt(numImagesSlider.value, 10),
            aspectRatio: aspectRatioSelect.value as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
            outputMimeType: 'image/jpeg',
        },
    });

    if (response?.generatedImages && response.generatedImages.length > 0) {
        response.generatedImages.forEach((generatedImage: GeneratedImage) => {
            if (generatedImage.image?.imageBytes) {
                appendImageToGallery(generatedImage.image.imageBytes, promptInput.value);
            }
        });
    } else {
        displayError('Изображения не были сгенерированы. Возможно, промпт был заблокирован.');
    }
}

/**
 * Edits an existing image based on a text prompt using Gemini.
 */
async function editImage() {
    if (uploadedImages.length === 0) return;

    const imageParts = uploadedImages.map(image => ({
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    }));

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: {
            parts: [
                ...imageParts,
                { text: promptInput.value },
            ],
        },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    
    let imageFound = false;
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            imageFound = true;
            appendImageToGallery(part.inlineData.data, promptInput.value);
        }
    }
    
    if(!imageFound) {
         displayError('В ответе не было сгенерировано изображение.');
    }
}


// --- HELPER FUNCTIONS ---

/**
 * Appends a base64 encoded image to the gallery.
 * @param base64String The base64 encoded image data.
 * @param altText The alt text for the image.
 */
function appendImageToGallery(base64String: string, altText: string) {
    if (!imageGallery) return;

    const src = `data:image/jpeg;base64,${base64String}`;
    const img = new Image();
    img.src = src;
    img.alt = altText;
    imageGallery.appendChild(img);
}

// --- INITIALIZATION ---
function init() {
    // Initial UI state setup
    updateUiForMode();
}

init();