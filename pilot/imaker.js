
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const url = require('url');

// État de création pour chaque utilisateur
const userCreateStates = {};

// Fonction principale pour gérer les messages entrants pour imaker
async function handleImakerMessage(senderId, message, sendMessageFunc) {
    // Si c'est la première interaction avec imaker
    if (!userCreateStates[senderId]) {
        userCreateStates[senderId] = {
            step: 'start',
            commandName: '',
            apiUrl: '',
            promptParam: '',
            imageParam: '',
            uidParam: ''
        };
        await sendMessageFunc(senderId, "La commande imaker est activée. Cette commande vous permettra de créer une nouvelle commande qui utilise des images.\n\nQuel est le nom de la commande à créer ?");
        return;
    }

    const state = userCreateStates[senderId];

    // Traitement des différentes étapes
    switch (state.step) {
        case 'start':
            // Validation du nom de la commande
            const commandName = message.trim().toLowerCase();
            if (!commandName || /[^a-z0-9]/.test(commandName)) {
                await sendMessageFunc(senderId, "Le nom de la commande doit contenir uniquement des lettres minuscules et des chiffres. Veuillez réessayer:");
                return;
            }

            // Vérifier si la commande existe déjà
            const commandsDir = path.join(__dirname, '../commands');
            const routersDir = path.join(__dirname, '../routers');
            
            if ((fs.existsSync(path.join(commandsDir, `${commandName}.js`))) || 
                (fs.existsSync(routersDir) && fs.existsSync(path.join(routersDir, `${commandName}.js`)))) {
                await sendMessageFunc(senderId, `La commande "${commandName}" existe déjà. Veuillez choisir un autre nom:`);
                return;
            }

            state.commandName = commandName;
            state.step = 'api_url';
            await sendMessageFunc(senderId, `Création du nom "${commandName}" avec succès.\nDonnez-moi l'API URL à inclure dans la commande, qui doit contenir les paramètres prompt, uid et image:`);
            break;

        case 'api_url':
            const apiUrl = message.trim();
            
            if (!apiUrl.startsWith('http')) {
                await sendMessageFunc(senderId, "L'URL doit commencer par http:// ou https://. Veuillez réessayer:");
                return;
            }

            try {
                // Vérifier si l'URL est répétée (une erreur courante)
                if (apiUrl.includes('https://') && apiUrl.lastIndexOf('https://') > 0) {
                    const firstHttpsIndex = apiUrl.indexOf('https://');
                    apiUrl = apiUrl.substring(0, apiUrl.lastIndexOf('https://'));
                    await sendMessageFunc(senderId, "J'ai détecté une URL répétée et j'ai corrigé le format.");
                }
                
                // Analyser l'URL pour extraire les paramètres
                const parsedUrl = new URL(apiUrl);
                const params = new URLSearchParams(parsedUrl.search);
                
                // Extraire et stocker les noms des paramètres
                let foundPrompt = false;
                let foundUid = false;
                let foundImage = false;

                for (const [key, value] of params.entries()) {
                    if (key.toLowerCase().includes('prompt')) {
                        state.promptParam = key;
                        foundPrompt = true;
                    }
                    if (key.toLowerCase().includes('uid') || key.toLowerCase().includes('id')) {
                        state.uidParam = key;
                        foundUid = true;
                    }
                    if (key.toLowerCase().includes('image')) {
                        state.imageParam = key;
                        foundImage = true;
                    }
                }

                if (!foundPrompt || !foundUid || !foundImage) {
                    await sendMessageFunc(senderId, "L'URL doit contenir des paramètres pour 'prompt', 'uid' et 'image'. Veuillez fournir une URL valide:");
                    return;
                }

                state.apiUrl = apiUrl;
                state.step = 'finished';
                
                // Créer le fichier de commande
                await createCommandFile(state);
                
                await sendMessageFunc(senderId, `Merci ! Je vais créer votre commande "${state.commandName}" et l'ajouter dans le répertoire routers.`);
                await sendMessageFunc(senderId, `Création de la commande "${state.commandName}" terminée avec succès ! Vous pouvez maintenant l'utiliser en envoyant "${state.commandName}" suivi d'une question, ou en envoyant une image.`);
                
                // Réinitialiser l'état
                delete userCreateStates[senderId];
            } catch (error) {
                console.error('Erreur lors de l\'analyse de l\'URL:', error);
                await sendMessageFunc(senderId, "L'URL fournie n'est pas valide. Veuillez réessayer avec une URL correcte:");
            }
            break;
    }
}

// Fonction pour créer le fichier de commande
async function createCommandFile(state) {
    try {
        // Extraire la base de l'URL sans les paramètres
        const apiUrlBase = state.apiUrl.split('?')[0];
        
        // Créer le répertoire routers s'il n'existe pas
        const routersDir = path.join(__dirname, '../routers');
        await fs.ensureDir(routersDir);
        
        // Créer le contenu du fichier
        const fileContent = `const sendMessage = require('../handles/sendMessage');
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
    
    console.log(\`Découpage du message de longueur: \${text.length} caractères\`);
    
    if (text.length <= MAX_CHUNK_SIZE) {
        // Message assez court, envoyer directement
        console.log(\`Envoi direct du message (\${text.length} caractères)\`);
        await sendMessage(senderId, text);
        return;
    }
    
    // Découper le message en morceaux
    const totalChunks = Math.ceil(text.length / MAX_CHUNK_SIZE);
    console.log(\`Le message sera découpé en \${totalChunks} parties\`);
    
    // Diviser le texte en paragraphes
    const paragraphs = text.split(/\\n+/);
    let currentChunk = '';
    let chunkIndex = 1;
    
    for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        
        // Si l'ajout du paragraphe dépasse la limite, envoyer le chunk actuel
        if (currentChunk.length + paragraph.length + 2 > MAX_CHUNK_SIZE) {
            if (currentChunk.length > 0) {
                // Ajouter un indicateur de partie
                const messageToSend = \`[Partie \${chunkIndex}/\${totalChunks}]\\n\${currentChunk}\`;
                console.log(\`Envoi de la partie \${chunkIndex}/\${totalChunks} (\${messageToSend.length} caractères)\`);
                
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
                const messageToSend = \`[Partie \${chunkIndex}/\${totalChunks}]\\n\${partToSend}\`;
                console.log(\`Envoi de la partie \${chunkIndex}/\${totalChunks} (paragraphe long) (\${messageToSend.length} caractères)\`);
                
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
                currentChunk += '\\n\\n';
            }
            currentChunk += paragraph;
        }
    }
    
    // Envoyer le dernier chunk s'il reste du contenu
    if (currentChunk.length > 0) {
        const messageToSend = \`[Partie \${chunkIndex}/\${totalChunks}]\\n\${currentChunk}\`;
        console.log(\`Envoi de la dernière partie \${chunkIndex}/\${totalChunks} (\${messageToSend.length} caractères)\`);
        await sendMessage(senderId, messageToSend);
    }
    
    console.log(\`Envoi du message complet terminé (\${totalChunks} parties)\`);
}

module.exports = async (senderId, prompt, attachments = []) => {
    try {
        // Vérifier si un message de début est nécessaire
        if (!prompt && !attachments.length) {
            await sendMessage(senderId, "La commande ${state.commandName} est activée. Envoyez une image avec une description ou posez une question.");
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

        // Préparer l'appel API
        let apiUrl = '${apiUrlBase}?';
        
        // Ajouter les paramètres
        apiUrl += \`${state.promptParam}=\${encodeURIComponent(prompt)}\`;
        
        // Ajouter l'ID utilisateur
        apiUrl += \`&${state.uidParam}=\${senderId}\`;
        
        // Ajouter l'URL de l'image si présente
        if (imageUrl) {
            apiUrl += \`&${state.imageParam}=\${encodeURIComponent(imageUrl)}\`;
        }

        // Informer l'utilisateur que la requête est en cours
        await sendMessage(senderId, "Traitement de votre demande en cours...");

        // Appeler l'API
        console.log(\`Appel API: \${apiUrl}\`);
        const response = await axios.get(apiUrl);
        
        // Vérifier si la réponse contient les données attendues
        if (response.data && response.data.response) {
            console.log(\`Réponse reçue de l'API, longueur: \${response.data.response.length} caractères\`);
            // Utiliser la fonction de découpage pour envoyer la réponse
            await sendChunkedMessage(senderId, response.data.response);
        } else {
            console.log('Réponse API invalide:', response.data);
            await sendMessage(senderId, "Désolé, je n'ai pas pu obtenir une réponse valide de l'API.");
        }
    } catch (error) {
        console.error('Erreur lors de l\\'exécution de la commande ${state.commandName}:', error);
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors du traitement de votre demande.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "${state.commandName}",
    description: "Commande interactive avec support d'images pour ${state.commandName}.",
    usage: "Envoyez '${state.commandName}' suivi d'une question ou envoyez une image avec une description."
};
`;

        // Écrire le fichier
        await fs.writeFile(path.join(routersDir, `${state.commandName}.js`), fileContent);
        console.log(`Commande ${state.commandName} créée avec succès dans le répertoire routers/`);
        
        return true;
    } catch (error) {
        console.error('Erreur lors de la création du fichier de commande:', error);
        return false;
    }
}

module.exports = {
    handleImakerMessage,
    userCreateStates
};
