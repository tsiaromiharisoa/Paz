
const sendMessage = require('../handles/sendMessage');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// État pour stocker les images temporaires
const tempImageStates = {};

module.exports = async (senderId, prompt, attachments = []) => {
    try {
        // Vérifier si un message de début est nécessaire
        if (!prompt && !attachments.length) {
            await sendMessage(senderId, "La commande gemini est activée. Envoyez une image avec une description ou posez une question.");
            return;
        }

        // Gérer les pièces jointes d'images
        let imageUrl = '';
        if (attachments && attachments.length > 0) {
            const imageAttachments = attachments.filter(att => att.type === 'image');
            if (imageAttachments.length > 0) {
                imageUrl = imageAttachments[0].payload.url;
                
                // Si l'utilisateur a envoyé une image sans prompt
                if (!prompt) {
                    tempImageStates[senderId] = imageUrl;
                    await sendMessage(senderId, "Image reçue. Veuillez maintenant envoyer une description ou une question concernant cette image.");
                    return;
                }
            }
        }

        // Vérifier s'il y a une image en attente
        if (!imageUrl && tempImageStates[senderId] && prompt) {
            imageUrl = tempImageStates[senderId];
            delete tempImageStates[senderId]; // Nettoyer après utilisation
        }

        if (!imageUrl && prompt.includes("photo") || prompt.includes("image") || prompt.includes("décrivez")) {
            await sendMessage(senderId, "Veuillez me fournir la photo à décrire ! Je suis prêt à analyser les éléments visuels et à vous donner une description détaillée.");
            return;
        }

        // Préparer l'appel API
        let apiUrl = 'https://api-test-liart-alpha.vercel.app/gemini?';
        
        // Ajouter les paramètres
        apiUrl += `prompt=${encodeURIComponent(prompt)}`;
        
        // Ajouter l'ID utilisateur
        apiUrl += `&uid=${senderId}`;
        
        // Ajouter l'URL de l'image si présente
        if (imageUrl) {
            apiUrl += `&image=${encodeURIComponent(imageUrl)}`;
            console.log(`Envoi d'image à l'API: ${imageUrl}`);
        }

        // Informer l'utilisateur que la requête est en cours
        await sendMessage(senderId, "Traitement de votre demande en cours...");

        // Appeler l'API
        console.log(`Appel API: ${apiUrl}`);
        const response = await axios.get(apiUrl);
        
        // Vérifier si la réponse contient les données attendues
        if (response.data && response.data.response) {
            await sendMessage(senderId, response.data.response);
        } else {
            await sendMessage(senderId, "Désolé, je n'ai pas pu obtenir une réponse valide de l'API.");
        }
    } catch (error) {
        console.error('Erreur lors de l\'exécution de la commande gemini:', error);
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors du traitement de votre demande.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "gemini",
    description: "Commande interactive avec support d'images pour gemini.",
    usage: "Envoyez 'gemini' suivi d'une question ou envoyez une image avec une description."
};
