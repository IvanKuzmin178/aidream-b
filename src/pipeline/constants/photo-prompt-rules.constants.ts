import type { ProjectStyle } from '../../projects/entities/project.entity';

export interface PhotoPromptRule {
  singleAnalysisPrompt: string;
  pairAnalysisPrompt: string;
  singleSceneSuffix: string;
  transitionSceneSuffix: string;
}

const FACE_TRANSITION_RULES = `
Hard constraints for faces and people:
1. Any visible face in the start frame must leave the frame immediately.
2. No clear face may remain visible through the main body of the transition.
3. Never use direct face-to-face morphing, blended faces, or intermediate facial distortions.
4. The face from the end frame may appear only in the final part of the shot, near the last frames.
5. Remove faces naturally through body movement or camera choreography: turning away, moving past camera, back view, side profile, silhouette, camera reframing.
6. In the middle section, rely on body silhouette, shoulders, clothing, gesture, architecture, landscape, light, reflections, texture, and scene motion — not faces.
7. Avoid fake masking tricks: no arbitrary foreground wipe, no sudden full-frame blockage, no artificial occlusion used only to hide a cut.
8. Motion must remain readable, organic, physically believable, and continuous.
9. Final face reveal must happen only after the target scene is already established and stable.
`;

const TRANSITION_NEGATIVE_RULES = `
Forbidden:
- face morphing
- blended faces
- duplicate facial features
- melting anatomy
- unstable eyes or mouth
- prolonged frontal face visibility during transition
- arbitrary foreground wipe used only to hide a cut
- fake occlusion that breaks spatial continuity
- random visual tricks with no physical motivation
`;

export const PHOTO_PROMPT_RULES: Record<ProjectStyle, PhotoPromptRule> = {
  memory: {
    singleAnalysisPrompt: `Describe this photo in 2 short sentences.
Focus on: main subject, setting, emotional tone, lighting, pose, and nostalgic details.
Keep it concise, visual, and evocative.
Output only the description.`,

    pairAnalysisPrompt: `Analyze these two photos for a memory-style transition.
Write 4 short sections:
1. Start frame: subject, setting, lighting, emotional tone, visible faces, body direction.
2. End frame: subject, setting, lighting, emotional tone, visible faces, body direction.
3. Continuity bridge: identify the most natural transition logic between the frames using motion, silhouette, environment, camera travel, gesture, direction, texture, architecture, landscape, reflections, or light.
4. Face strategy: explain how the start face exits immediately, how faces stay absent through the middle, and how the end face appears only at the end.
Be concrete, cinematic, and physically believable.
Output only the analysis.`,

    singleSceneSuffix: `Create a warm, nostalgic living memory from this still image: {description}
Use subtle natural motion, gentle breathing of the frame, soft handheld drift, warm golden light, and tender emotional realism.
The image should feel like a remembered moment quietly coming back to life.`,

    transitionSceneSuffix: `Create a warm, nostalgic memory-like transition between these two frames.
Start from: {description1}
End at: {description2}

The transition must feel emotionally continuous, tender, and physically believable, as if the memory is unfolding naturally from one lived moment into another.
Use soft camera drift, gentle subject motion, environmental continuity, and poetic realism.
Prioritize human motion, silhouette continuity, light flow, fabric movement, background depth, and lived atmosphere over flashy transition tricks.

${FACE_TRANSITION_RULES}`.trim()
+ TRANSITION_NEGATIVE_RULES.trim(),
  },

  cinematic: {
    singleAnalysisPrompt: `Describe this photo in 2 short sentences.
Focus on: subjects, composition, lighting direction, atmosphere, dramatic tension, and visual anchors.
Keep it concise and cinematic.
Output only the description.`,

    pairAnalysisPrompt: `Analyze these two photos for a cinematic transition.
Write 4 short sections:
1. Start frame: key subject, composition, lighting, visible faces, body direction, dominant shapes and lines.
2. End frame: key subject, composition, lighting, visible faces, body direction, dominant shapes and lines.
3. Transition logic: propose an original but believable cinematic bridge using camera movement, blocking, parallax, architecture, landscape, reflections, motion direction, or subject choreography.
4. Face strategy: explain how the start face exits immediately, how the middle remains face-free, and how the end face enters only in the final beat.
The transition should feel like one continuous shot, not a hidden cut.
Output only the analysis.`,

    singleSceneSuffix: `Create a cinematic, dramatic shot from this still image: {description}
Use controlled camera motion, depth, realistic motion cues, high visual tension, and refined cinematic realism.
The frame should feel alive, intentional, and film-like rather than animated arbitrarily.`,

    transitionSceneSuffix: `Create a cinematic transition between these two frames as one continuous, physically motivated shot.
Start from: {description1}
End at: {description2}

Do not make this a generic dissolve or a simple replacement of one frame with another.
Invent an original, visually motivated transition based on camera travel, subject blocking, environment, geometry, motion flow, light, atmosphere, and believable choreography.
The shot must remain readable, elegant, and physically continuous.
Use strong cinematic direction, but avoid artificial gimmicks.

${FACE_TRANSITION_RULES}`.trim()
+ TRANSITION_NEGATIVE_RULES.trim(),
  },

  dream: {
    singleAnalysisPrompt: `Describe this photo in 2 short sentences.
Focus on: subject, atmosphere, color palette, emotional tone, textures, and dreamlike visual qualities.
Keep it concise, soft, and evocative.
Output only the description.`,

    pairAnalysisPrompt: `Analyze these two photos for a dream-style transition.
Write 4 short sections:
1. Start frame: subject, mood, visible faces, colors, direction of motion, dreamlike elements.
2. End frame: subject, mood, visible faces, colors, direction of motion, dreamlike elements.
3. Dream bridge: propose an imaginative but still coherent transition using flowing motion, atmosphere, silhouette, texture, light bloom, reflections, depth, symbolic continuity, or surreal environmental transformation.
4. Face strategy: explain how the start face disappears immediately, how the middle stays face-free, and how the end face emerges only near the final frames.
The result must feel fluid and poetic, but not anatomically unstable.
Output only the analysis.`,

    singleSceneSuffix: `Create a dreamy, ethereal living scene from this still image: {description}
Use floating motion, soft atmospheric movement, delicate light bloom, pastel or luminous tonal flow, and calm visual poetry.
The image should feel like a dream remembered from within, not like a random fantasy effect.`,

    transitionSceneSuffix: `Create a dreamy, ethereal transition between these two frames.
Start from: {description1}
End at: {description2}

The transition may be imaginative, symbolic, and fluid, but it must still feel visually coherent and emotionally continuous.
Use atmosphere, silhouette, soft motion, light drift, reflections, environmental transformation, and dreamlike continuity instead of direct morph tricks.
Keep anatomy stable and motion graceful.

${FACE_TRANSITION_RULES}`.trim()
+ TRANSITION_NEGATIVE_RULES.trim(),
  },
};