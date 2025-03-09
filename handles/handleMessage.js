const fs = require('fs-extra');
const path = require('path');
const sendMessage = require('./sendMessage'); // Assurez-vous que ce fichier existe
const axios = require('axios');
const maker = require('../pilot/maker'); // Importer maker.js
const { handleMakerMessage } = maker; // Destructurer l'objet
const imaker = require('../pilot/imaker'); // Importer imaker.js
const { handleImakerMessage } = imaker; // Destructurer l'objet

// Charger toutes les commandes du dossier 'commands'
const commandFiles = fs.readdirSync(path.join(__dirname, '../commands')).filter(file => file.endsWith('.js'));
const commands = {};

// Charger toutes les commandes du dossier 'routers' si ce dossier existe
const routersDir = path.join(__dirname, '../routers');
if (fs.existsSync(routersDir)) {
    const routerFiles = fs.readdirSync(routersDir).filter(file => file.endsWith('.js'));
    for (const file of routerFiles) {
        const commandName = file.replace('.js', '');
        commands[commandName] = require(`../routers/${file}`);
        console.log(`Commande router chargée: ${commandName}`);
    }
}

// État de pagination global pour être accessible dans ce module
const userPaginationStates = {};

// Charger les commandes dans un objet
for (const file of commandFiles) {
    const commandName = file.replace('.js', '');
    commands[commandName] = require(`../commands/${file}`);

    // Si c'est la commande help, récupérer son état de pagination
    if (commandName === 'help' && commands[commandName].userPaginationStates) {
        Object.assign(userPaginationStates, commands[commandName].userPaginationStates);
    }
}

console.log('Les commandes suivantes ont été chargées :', Object.keys(commands));

const activeCommands = {};
const imageHistory = {};
const MAX_MESSAGE_LENGTH = 2000; // Limite de caractères pour chaque message envoyé

// Fonction pour envoyer des messages longs en plusieurs parties si nécessaire
async function sendLongMessage(senderId, message) {
    const MAX_MESSAGE_LENGTH = 2000; // Limite de caractères par message Facebook

    if (message.length <= MAX_MESSAGE_LENGTH) {
        // Si le message est assez court, l'envoyer directement
        await sendMessage(senderId, message);
        return;
    }

    // Diviser le message en plusieurs parties
    for (let i = 0; i < message.length; i += MAX_MESSAGE_LENGTH) {
        const messagePart = message.substring(i, Math.min(i + MAX_MESSAGE_LENGTH, message.length));
        await sendMessage(senderId, messagePart);
        await new Promise(resolve => setTimeout(resolve, 1000));  // Pause de 1s entre chaque message
    }
}

// Fonction pour détecter les mots-clés d'exercice
function detectExerciseKeywords(text) {
    const keywords = ["calculer", "exercices", "1)", "2)", "3)", "a)", "b)", "c)", "d)", "?"];
    return keywords.some(keyword => text.toLowerCase().includes(keyword));
}

// Gestion des messages entrants
const handleMessage = async (event, api) => {
    const senderId = event.sender.id;
    const message = event.message;

    // Message d'attente simple sans bloquer le traitement
    const typingMessage = "🇲🇬 🔄 Generating...";
    sendMessage(senderId, typingMessage).catch(err => console.error("Erreur lors de l'envoi du message d'attente:", err));
    // Pas de délai supplémentaire pour ne pas bloquer le traitement

    // Commande "stop" pour désactiver toutes les commandes persistantes
    if (message.text && message.text.toLowerCase() === 'stop') {
        activeCommands[senderId] = null;
        await sendMessage(senderId, "Toutes les commandes sont désactivées. Vous pouvez maintenant envoyer d'autres messages.");
        return;
    }

    // Si l'utilisateur est en mode maker, ne pas traiter les pièces jointes
    if (maker.userCreateStates[senderId]) {
        await handleMakerMessage(senderId, message.text || "", sendMessage);
        return;
    }

    // Vérifier si le message a des pièces jointes
    const hasAttachments = message.attachments && message.attachments.length > 0;
    const imageAttachments = hasAttachments ? message.attachments.filter(attachment => attachment.type === 'image') : [];
    const hasImages = imageAttachments.length > 0;

    // Texte de l'utilisateur (même vide)
    // Définir ces variables une seule fois dans tout le code
    const userText = message.text ? message.text.trim() : "";
    const userTextLower = userText.toLowerCase();

    // Détecter si une commande est utilisée avec une image jointe
    let isCommandWithImage = false;
    let commandWithImage = null;
    let commandPromptWithImage = "";

    if (hasImages && userText) {
        for (const commandName in commands) {
            if (userTextLower.startsWith(commandName)) {
                isCommandWithImage = true;
                commandWithImage = commandName;
                commandPromptWithImage = userText.replace(commandName, '').trim();
                break;
            }
        }
    }

    // Si une commande avec image est détectée, l'exécuter
    if (isCommandWithImage) {
        try {
            // Traiter l'historique des images
            if (!imageHistory[senderId]) {
                imageHistory[senderId] = [];
            }
            imageAttachments.forEach(img => {
                imageHistory[senderId].push(img.payload.url);
            });

            // Vérifier si la commande accepte des pièces jointes
            if (typeof commands[commandWithImage] === 'function') {
                const commandFunc = commands[commandWithImage];
                // Déterminer si la fonction accepte des pièces jointes (3 paramètres)
                const funcStr = commandFunc.toString();
                const acceptsAttachments = funcStr.includes('attachments') || funcStr.includes('...args');
                
                if (acceptsAttachments) {
                    console.log(`Exécution de la commande ${commandWithImage} avec image`);
                    await commandFunc(senderId, commandPromptWithImage, message.attachments);
                } else {
                    console.log(`La commande ${commandWithImage} ne supporte pas les images, traitement standard`);
                    await commandFunc(senderId, commandPromptWithImage);
                }
            }
            return;
        } catch (error) {
            console.error(`Erreur lors de l'exécution de la commande ${commandWithImage} avec image:`, error);
            await sendMessage(senderId, "Une erreur s'est produite lors du traitement de votre commande avec image.");
            return;
        }
    }

    // Vérifier si une commande du répertoire routers est activée
    const hasActiveRouterCommand = activeCommands[senderId] && 
                                  fs.existsSync(path.join(__dirname, '../routers', `${activeCommands[senderId]}.js`));
    
    // Si une commande du répertoire routers est active, lui passer toutes les images
    if (hasActiveRouterCommand && hasImages) {
        const activeCommand = activeCommands[senderId];
        await commands[activeCommand](senderId, userText, message.attachments);
        return;
    }
    
    // Si des images sont envoyées sans commande et qu'aucune commande router n'est active, utiliser le comportement par défaut
    if (hasImages && !isCommandWithImage && !hasActiveRouterCommand) {
        if (imageAttachments.length > 0) {
            for (const image of imageAttachments) {
                const imageUrl = image.payload.url;

                try {
                    // Historique des images envoyées par l'utilisateur
                    if (!imageHistory[senderId]) {
                        imageHistory[senderId] = [];
                    }
                    imageHistory[senderId].push(imageUrl);

                    // Utiliser l'API OCR pour analyser l'image
                    const ocrResponse = await axios.post('https://gemini-sary-prompt-espa-vercel-api.vercel.app/api/gemini', {
                        link: imageUrl,
                        prompt: "Analyse du texte de l'image pour détection de mots-clés",
                        customId: senderId
                    });

                    const ocrText = ocrResponse.data.message || "";
                    const hasExerciseKeywords = detectExerciseKeywords(ocrText);

                    // Si l'utilisateur a fourni du texte, l'utiliser comme prompt
                    const prompt = userText ? userText : (hasExerciseKeywords
                        ? "Faire cet exercice et donner la correction complète de cet exercice"
                        : "Décrire cette photo");

                    // Demander à l'API de décrire ou résoudre l'exercice
                    const response = await axios.post('https://gemini-sary-prompt-espa-vercel-api.vercel.app/api/gemini', {
                        link: imageUrl,
                        prompt,
                        customId: senderId
                    });

                    const reply = response.data.message;

                    if (reply) {
                        await sendLongMessage(senderId, `Bruno : voici ma suggestion de réponse pour cette image :\n${reply}`);
                    } else {
                        await sendMessage(senderId, "Je n'ai pas reçu de réponse valide pour l'image.");
                    }
                } catch (error) {
                    console.error('Erreur lors de l\'analyse de l\'image :', error.response ? error.response.data : error.message);
                    await sendMessage(senderId, "Une erreur s'est produite lors de la description de l'image.");
                }
            }
        } else {
            await sendMessage(senderId, "Aucune image n'a été trouvée dans le message.");
        }
        return;
    }

    // Vérifier si l'utilisateur utilise la commande maker ou imaker
    if (userTextLower === 'maker') {
        await handleMakerMessage(senderId, '', sendMessage);
        return;
    } else if (userTextLower === 'imaker') {
        await handleImakerMessage(senderId, '', sendMessage);
        return;
    }

    // Vérifier si l'utilisateur est en processus de création avec maker ou imaker
    if (maker.userCreateStates[senderId]) {
        await handleMakerMessage(senderId, message.text, sendMessage);
        return;
    } else if (imaker.userCreateStates[senderId]) {
        await handleImakerMessage(senderId, message.text, sendMessage);
        return;
    }

    // Vérifier d'abord si l'utilisateur est en mode pagination pour help
    if (userPaginationStates[senderId] && userPaginationStates[senderId].isActive) {
        // Passer le texte à la commande help pour la navigation
        await commands['help'](senderId, userText);
        return;
    }

    // Si une commande persistante est active pour cet utilisateur
    if (activeCommands[senderId] && activeCommands[senderId] !== 'help') {
        const activeCommand = activeCommands[senderId];
        console.log(`Commande persistante en cours pour ${senderId}: ${activeCommand}`);
        
        // Vérifier si c'est une commande du dossier routers
        const isRouterCommand = fs.existsSync(path.join(__dirname, '../routers', `${activeCommand}.js`));
        
        // Si la commande est du répertoire routers, lui passer tous les attachements
        if (isRouterCommand) {
            await commands[activeCommand](senderId, userText, message.attachments || []);
            return;
        } else {
            // Sinon, comportement normal
            await commands[activeCommand](senderId, userText);
            return;
        }
    }

    // Vérifier si une commande router est active avant de permettre l'exécution d'autres commandes
    const hasActiveRouterCommand = activeCommands[senderId] && 
                                  fs.existsSync(path.join(__dirname, '../routers', `${activeCommands[senderId]}.js`));
    
    // Détecter et exécuter une commande seulement si aucune commande router n'est active
    // ou si c'est la commande "stop" (qui est traitée plus haut)
    if (!hasActiveRouterCommand || userTextLower === 'stop') {
        for (const commandName in commands) {
            if (userTextLower.startsWith(commandName)) {
                console.log(`Commande détectée : ${commandName}`);
                const commandPrompt = userText.replace(commandName, '').trim();

                if (commandName === 'help' || commandName === 'restart') {
                // Les commandes help et restart sont exécutées avec les arguments fournis
                await commands[commandName](senderId, commandPrompt);
                activeCommands[senderId] = null; // Désactivation automatique
                return;
            } else {
                // Activer une commande persistante
                activeCommands[senderId] = commandName;
                await commands[commandName](senderId, commandPrompt);
                return;
            }
        }
    }
}


    // Vérifier si le message contient une URL et si l'utilisateur n'est pas déjà dans un processus spécifique
    const containsUrl = /https?:\/\/[^\s]+/.test(userText);

    // Si le message contient une URL, informer l'utilisateur qu'il peut utiliser 'maker' pour créer une commande
    if (containsUrl && !activeCommands[senderId]) {
        await sendMessage(senderId, "J'ai détecté une URL dans votre message. Si vous souhaitez créer une commande basée sur cette API, utilisez la commande 'maker'.");
    }

    // Vérifier si une commande du répertoire routers est activée
    const hasActiveRouterCommand = activeCommands[senderId] && 
                                  fs.existsSync(path.join(__dirname, '../routers', `${activeCommands[senderId]}.js`));
    
    // Si aucune commande n'est active ou détectée et qu'aucune commande router n'est active, utiliser Gemini pour traiter le texte
    if (!hasActiveRouterCommand) {
        const prompt = message.text;
        const customId = senderId;

        try {
            const response = await axios.post('https://gemini-sary-prompt-espa-vercel-api.vercel.app/api/gemini', {
                prompt,
                customId
            });
            const reply = response.data.message;
            await sendLongMessage(senderId, reply);
        } catch (error) {
        console.error('Erreur lors de l\'appel à l\'API :', error);
        await sendMessage(senderId, 'Désolé, une erreur s\'est produite lors du traitement de votre message.');
        }
    }
};

module.exports = handleMessage;