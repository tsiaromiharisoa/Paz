
const sendMessage = require('../handles/sendMessage');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// État pour stocker les images temporaires
const tempImageStates = {};

// Fonction pour découper et envoyer les messages longs
async function sendChunkedMessage(senderId, text) {
    // Limite de caractères pour Facebook Messenger (réduite pour plus de sécurité)
    const MAX_CHUNK_SIZE = 1500;
    
    if (!text || text.length === 0) {
        console.log("Texte vide, rien à envoyer");
        return;
    }
    
    console.log(`Découpage du message de longueur: ${text.length} caractères`);
    
    if (text.length <= MAX_CHUNK_SIZE) {
        // Message assez court, envoyer directement
        console.log(`Envoi direct du message (${text.length} caractères)`);
        await sendMessage(senderId, text);
        return;
    }
    
    // Découper le message en morceaux
    const totalChunks = Math.ceil(text.length / MAX_CHUNK_SIZE);
    console.log(`Le message sera découpé en ${totalChunks} parties`);
    
    // Diviser le texte en paragraphes
    const paragraphs = text.split(/\n+/);
    let currentChunk = '';
    let chunkIndex = 1;
    
    for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        
        // Si l'ajout du paragraphe dépasse la limite, envoyer le chunk actuel
        if (currentChunk.length + paragraph.length + 2 > MAX_CHUNK_SIZE) {
            if (currentChunk.length > 0) {
                // Ajouter un indicateur de partie
                const messageToSend = `[Partie ${chunkIndex}/${totalChunks}]\n${currentChunk}`;
                console.log(`Envoi de la partie ${chunkIndex}/${totalChunks} (${messageToSend.length} caractères)`);
                
                await sendMessage(senderId, messageToSend);
                chunkIndex++;
                currentChunk = '';
                
                // Délai entre les messages pour éviter les limitations
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Si le paragraphe seul est plus grand que la taille maximale, le découper
        if (paragraph.length > MAX_CHUNK_SIZE) {
            let remainingParagraph = paragraph;
            while (remainingParagraph.length > 0) {
                let cutPoint = MAX_CHUNK_SIZE;
                if (cutPoint < remainingParagraph.length) {
                    // Trouver un bon point de découpe (fin de phrase ou espace)
                    const sentenceBreak = remainingParagraph.lastIndexOf('. ', cutPoint);
                    const spaceBreak = remainingParagraph.lastIndexOf(' ', cutPoint);
                    cutPoint = sentenceBreak > 0 ? sentenceBreak + 1 : (spaceBreak > 0 ? spaceBreak + 1 : cutPoint);
                }
                
                const partToSend = remainingParagraph.substring(0, cutPoint);
                const messageToSend = `[Partie ${chunkIndex}/${totalChunks}]\n${partToSend}`;
                console.log(`Envoi de la partie ${chunkIndex}/${totalChunks} (paragraphe long) (${messageToSend.length} caractères)`);
                
                await sendMessage(senderId, messageToSend);
                chunkIndex++;
                remainingParagraph = remainingParagraph.substring(cutPoint);
                
                if (remainingParagraph.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } else {
            // Ajouter le paragraphe au chunk actuel
            if (currentChunk.length > 0) {
                currentChunk += '\n\n';
            }
            currentChunk += paragraph;
        }
    }
    
    // Envoyer le dernier chunk s'il reste du contenu
    if (currentChunk.length > 0) {
        const messageToSend = `[Partie ${chunkIndex}/${totalChunks}]\n${currentChunk}`;
        console.log(`Envoi de la dernière partie ${chunkIndex}/${totalChunks} (${messageToSend.length} caractères)`);
        await sendMessage(senderId, messageToSend);
    }
    
    console.log(`Envoi du message complet terminé (${totalChunks} parties)`);
}

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

        if (!imageUrl && (prompt.includes("photo") || prompt.includes("image") || prompt.includes("décrivez"))) {
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
            console.log(`Réponse reçue de l'API, longueur: ${response.data.response.length} caractères`);
            // Utiliser la fonction de découpage pour envoyer la réponse
            await sendChunkedMessage(senderId, response.data.response);
        } else {
            console.log('Réponse API invalide:', response.data);
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
